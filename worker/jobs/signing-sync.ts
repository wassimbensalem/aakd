/**
 * signing.sync job handler.
 * Polls DocuSeal for submission status updates, downloads signed PDFs,
 * and marks contracts as ACTIVE when signing is complete.
 *
 * Separated from the main worker.ts per CLAUDE.md convention:
 * "Job handlers live in worker/ — not in apps/web/"
 */
import { Worker, Job } from "bullmq"
import { getWorkerPrisma } from "@/lib/db/worker-client"
import { storage } from "@/lib/storage"
import { getSubmission, isAllowedDocuSealUrl } from "@/lib/docuseal"
import { enqueueNotification } from "@/lib/notifications/fanout"
import type { SigningSyncJobData } from "@/lib/jobs/queues"

// ─── Types ────────────────────────────────────────────────────────────────────

type SyncableContract = {
  id: string
  organizationId: string
  ownerId: string
  docusealSubmissionId: string | null
  signingStatus: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeDocuSealStatus(
  status: string,
): "completed" | "declined" | "expired" | "failed" | "sent" {
  const normalized = status.toLowerCase()
  if (normalized === "completed") return "completed"
  if (normalized === "declined") return "declined"
  if (normalized === "expired") return "expired"
  if (normalized === "failed") return "failed"
  return "sent"
}

async function persistSignedDocument(contract: SyncableContract, documentUrl: string) {
  // SSRF guard: only fetch from the configured DocuSeal host
  if (!isAllowedDocuSealUrl(documentUrl)) {
    throw new Error(`Rejected signed document URL from disallowed host: ${documentUrl}`)
  }

  const signedRes = await fetch(documentUrl)
  if (!signedRes.ok) {
    throw new Error(`Failed to download signed PDF: ${signedRes.status}`)
  }

  const buffer = Buffer.from(await signedRes.arrayBuffer())
  const newKey = storage.storageKey(
    contract.organizationId,
    contract.id,
    `signed_${Date.now()}.pdf`,
  )
  await storage.upload(newKey, buffer, "application/pdf")

  const db = getWorkerPrisma()
  const latestFile = await db.contractFile.findFirst({
    where: { contractId: contract.id, isLatest: true },
    orderBy: { version: "desc" },
    select: { id: true, version: true },
  })

  const nextVersion = (latestFile?.version ?? 0) + 1

  await db.$transaction([
    ...(latestFile
      ? [
          db.contractFile.update({
            where: { id: latestFile.id },
            data: { isLatest: false },
          }),
        ]
      : []),
    db.contractFile.create({
      data: {
        contractId: contract.id,
        filename: "signed_document.pdf",
        storageKey: newKey,
        mimeType: "application/pdf",
        sizeBytes: buffer.length,
        isSigned: true,
        isLatest: true,
        version: nextVersion,
        uploadedById: contract.ownerId,
      },
    }),
    db.contract.update({
      where: { id: contract.id },
      data: {
        status: "ACTIVE",
        signingStatus: "completed",
        signingUrl: null,
      },
    }),
  ])

  await db.activity.create({
    data: {
      contractId: contract.id,
      userId: null,
      actorLabel: "System",
      action: "SIGNED",
      detail: `Contract signed via DocuSeal sync (submission #${contract.docusealSubmissionId})`,
    },
  })

  await enqueueNotification("contract.signed", contract.id, null, {})
}

async function syncDocuSealContract(contract: SyncableContract) {
  if (!contract.docusealSubmissionId) return

  const submission = await getSubmission(Number(contract.docusealSubmissionId))
  if (!submission) return

  const signingStatus = normalizeDocuSealStatus(submission.status)
  if (signingStatus === contract.signingStatus) return

  if (signingStatus !== "completed") {
    await getWorkerPrisma().contract.update({
      where: { id: contract.id },
      data: { signingStatus },
    })
    if (signingStatus === "declined" || signingStatus === "expired") {
      await getWorkerPrisma().contractSigner.updateMany({
        where: { contractId: contract.id, status: "pending" },
        data: { status: "declined" },
      })
      await enqueueNotification("contract.signing_declined", contract.id, null, {
        signingStatus,
      })
    }
    return
  }

  const signedDocUrl = submission.documents?.[0]?.url
  if (!signedDocUrl) {
    console.warn(
      `[signing] Submission ${contract.docusealSubmissionId} is completed but has no document URL`,
    )
    return
  }

  await persistSignedDocument(contract, signedDocUrl)
}

// ─── Worker factory ───────────────────────────────────────────────────────────
// Call createSigningSyncWorker(connection) from apps/web/worker.ts to register
// the handler. This keeps the handler out of the Next.js app bundle while
// allowing the single worker entry point to remain in apps/web/.

export function createSigningSyncWorker(connection: { url: string }) {
  const worker = new Worker<SigningSyncJobData>(
    "signing.sync",
    async (job: Job<SigningSyncJobData>) => {
      console.log(`[signing] Running sync job ${job.id} (triggered: ${job.data.triggeredAt})`)

      const where = job.data.contractId
        ? { id: job.data.contractId }
        : job.data.submissionId
          ? { docusealSubmissionId: job.data.submissionId }
          : {
              docusealSubmissionId: { not: null },
              OR: [{ signingStatus: null }, { signingStatus: { not: "completed" } }],
            }

      const contracts = await getWorkerPrisma().contract.findMany({
        where,
        select: {
          id: true,
          organizationId: true,
          ownerId: true,
          docusealSubmissionId: true,
          signingStatus: true,
        },
        take: job.data.contractId || job.data.submissionId ? 1 : 100,
      })

      for (const contract of contracts) {
        try {
          await syncDocuSealContract(contract)
        } catch (err) {
          console.error(`[signing] Failed to sync contract ${contract.id}:`, err)
        }
      }

      console.log(`[signing] Synced ${contracts.length} DocuSeal submission(s)`)
    },
    { connection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } } },
  )

  worker.on("completed", (job) => console.log(`[signing] Job ${job.id} completed`))
  worker.on("failed", (job, err) => console.error(`[signing] Job ${job?.id} failed:`, err))

  return worker
}

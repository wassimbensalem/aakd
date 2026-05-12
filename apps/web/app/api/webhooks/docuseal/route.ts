import { createHmac, timingSafeEqual } from "crypto"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { storage } from "@/lib/storage"
import { isAllowedDocuSealUrl } from "@/lib/docuseal"
import { enqueueNotification } from "@/lib/notifications/fanout"

// ─── POST /api/webhooks/docuseal ──────────────────────────────────────────────
// Receives DocuSeal webhook events.
// This route is intentionally unauthenticated — DocuSeal calls it directly.
// We return 200 for all events to prevent DocuSeal retries on ignored events.
//
// Security: if DOCUSEAL_WEBHOOK_SECRET is set, the X-DocuSeal-Signature header
// must be a valid HMAC-SHA256 signature of the raw request body.

interface DocuSealWebhookPayload {
  event_type: string
  data: {
    id: number
    status?: string
    submission_id?: number   // present on form.* events (individual signer)
    slug?: string            // submitter slug
    documents?: { url: string }[]
  }
}

type SigningStatus = "completed" | "declined" | "expired" | "failed"

/**
 * Verify the HMAC-SHA256 signature from DocuSeal.
 * Returns true only when:
 *   - Secret is configured AND signature matches
 * Returns false (reject) when:
 *   - Secret is not configured (fail-secure — prevents forged webhook acceptance)
 *   - Signature header is missing or invalid
 */
function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.DOCUSEAL_WEBHOOK_SECRET
  if (!secret) {
    // No secret configured — reject all webhook requests to prevent forged events
    console.error(
      "[DocuSeal webhook] DOCUSEAL_WEBHOOK_SECRET is not set — rejecting all webhook calls. " +
      "Set this variable to enable DocuSeal webhook processing.",
    )
    return false
  }

  if (!signatureHeader) {
    return false
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex")

  // Support both plain hex and "sha256=<hex>" formats
  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice(7)
    : signatureHeader

  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"))
  } catch {
    // Lengths differ — definitely invalid
    return false
  }
}

function normalizeSigningStatus(payload: DocuSealWebhookPayload): SigningStatus | null {
  const eventType = payload.event_type.toLowerCase()
  const dataStatus = payload.data.status?.toLowerCase()

  // Individual signer completed — not a terminal submission event
  if (eventType === "form.completed" && payload.data.submission_id != null) return null

  if (eventType === "submission.completed" || dataStatus === "completed") return "completed"
  if (eventType === "form.declined" || dataStatus === "declined") return "declined"
  if (eventType === "form.expired" || dataStatus === "expired") return "expired"
  if (eventType === "form.failed" || dataStatus === "failed") return "failed"

  return null
}

export async function POST(req: Request) {
  // Read raw body first — needed for HMAC verification
  const rawBody = await req.text()

  const signatureHeader = req.headers.get("x-docuseal-signature")
  if (!verifySignature(rawBody, signatureHeader)) {
    return Response.json({ error: "Invalid or missing signature" }, { status: 403 })
  }

  let payload: DocuSealWebhookPayload
  try {
    payload = JSON.parse(rawBody) as DocuSealWebhookPayload
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { data } = payload

  // ── individual signer completed (form.completed with submission_id) ────────
  if (
    payload.event_type.toLowerCase() === "form.completed" &&
    data.submission_id != null
  ) {
    const submissionContract = await prisma.contract.findFirst({
      where: { docusealSubmissionId: String(data.submission_id) },
      select: { id: true },
    })

    if (submissionContract) {
      // Match by externalId — DocuSeal sends the numeric submitter id as data.id
      // and optionally the slug. Try both.
      const signerWhere = data.slug
        ? { contractId: submissionContract.id, externalId: data.slug }
        : { contractId: submissionContract.id, externalId: String(data.id) }

      await prisma.contractSigner.updateMany({
        where: signerWhere,
        data: { status: "signed", signedAt: new Date() },
      })

      // Write an activity row so the feed shows each individual signer completing
      await prisma.activity.create({
        data: {
          contractId: submissionContract.id,
          userId: null,
          actorLabel: "System",
          action: "SIGNED",
          detail: `Signer ${data.slug ?? data.id} completed signing`,
        },
      }).catch(() => {})
    }

    return Response.json({ ok: true })
  }

  const signingStatus = normalizeSigningStatus(payload)

  // Only process terminal signing states — acknowledge all others silently
  if (!signingStatus) {
    return Response.json({ ok: true })
  }

  // ── find the contract by submission ID ────────────────────────────────────
  const contract = await prisma.contract.findFirst({
    where: { docusealSubmissionId: String(data.id) },
    select: {
      id: true,
      organizationId: true,
      ownerId: true,
    },
  })

  // If not found, return 200 so DocuSeal stops retrying
  if (!contract) {
    return Response.json({ ok: true })
  }

  if (signingStatus !== "completed") {
    await prisma.contract.update({
      where: { id: contract.id, organizationId: contract.organizationId, status: "AWAITING_SIGNATURE" },
      data: { signingStatus },
    })

    await writeActivity(
      contract.id,
      null,
      "UPDATED",
      `DocuSeal submission #${data.id} marked ${signingStatus}`,
    )

    if (signingStatus === "declined" || signingStatus === "expired") {
      await enqueueNotification("contract.signing_declined", contract.id, null, {
        signingStatus,
      })
    }

    return Response.json({ ok: true })
  }

  // ── download signed PDF from DocuSeal ─────────────────────────────────────
  const signedDocUrl = data.documents?.[0]?.url
  if (!signedDocUrl) {
    console.warn(`[docuseal-webhook] No document URL in submission ${data.id}`)
    return Response.json({ ok: true })
  }

  // SSRF guard: only fetch from the configured DocuSeal host
  if (!isAllowedDocuSealUrl(signedDocUrl)) {
    console.error(
      `[docuseal-webhook] Rejected document URL from disallowed host: ${signedDocUrl}`,
    )
    return Response.json({ ok: true })
  }

  const signedRes = await fetch(signedDocUrl)
  if (!signedRes.ok) {
    console.error(`[docuseal-webhook] Failed to download signed PDF: ${signedRes.status}`)
    return Response.json({ ok: true })
  }

  const arrayBuffer = await signedRes.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // ── upload signed PDF to S3 ───────────────────────────────────────────────
  const newKey = storage.storageKey(
    contract.organizationId,
    contract.id,
    `signed_${Date.now()}.pdf`,
  )
  await storage.upload(newKey, buffer, "application/pdf")

  // ── mark all signers as signed ────────────────────────────────────────────
  await prisma.contractSigner.updateMany({
    where: { contractId: contract.id },
    data: { status: "signed", signedAt: new Date() },
  })

  // ── version bookkeeping ───────────────────────────────────────────────────
  const latestFile = await prisma.contractFile.findFirst({
    where: { contractId: contract.id, isLatest: true },
    orderBy: { version: "desc" },
    select: { id: true, version: true },
  })

  const nextVersion = (latestFile?.version ?? 0) + 1

  // Mark previous latest file as no longer latest, then create the signed file
  await prisma.$transaction([
    ...(latestFile
      ? [
          prisma.contractFile.update({
            where: { id: latestFile.id },
            data: { isLatest: false },
          }),
        ]
      : []),
    prisma.contractFile.create({
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
    prisma.contract.update({
      where: { id: contract.id, organizationId: contract.organizationId, status: "AWAITING_SIGNATURE" },
      data: {
        status: "ACTIVE",
        signingStatus: "completed",
        signingUrl: null,
      },
    }),
  ])

  await writeActivity(
    contract.id,
    null,
    "SIGNED",
    `Contract signed via DocuSeal (submission #${data.id})`,
  )

  await enqueueNotification("contract.signed", contract.id, null, {})

  return Response.json({ ok: true })
}

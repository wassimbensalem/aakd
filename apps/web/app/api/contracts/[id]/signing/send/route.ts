import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { storage } from "@/lib/storage"
import { createTemplate, addFieldsToTemplate, createSubmission } from "@/lib/docuseal"
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit"

// ─── POST /api/contracts/[id]/signing/send ────────────────────────────────────
// Sends all configured signers a DocuSeal submission simultaneously (parallel signing).

function hasRole(role: string, minimumRole: string): boolean {
  const hierarchy: Record<string, number> = { viewer: 0, member: 1, legal: 2, admin: 3, owner: 4 }
  return (hierarchy[role] ?? 0) >= (hierarchy[minimumRole] ?? 0)
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  if (!hasRole(ctx.role, "legal")) {
    return Response.json(
      { error: "Only admin or legal roles may initiate signing" },
      { status: 403 },
    )
  }

  // Signing is irreversible — restrict rate
  const rl = await rateLimit(`${ctx.organizationId}:sign`, 5, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter)

  return requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        organizationId: true,
        title: true,
        status: true,
        docusealSubmissionId: true,
      },
    })

    if (!contract || contract.organizationId !== ctx.organizationId) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    if (contract.status !== "AWAITING_SIGNATURE") {
      return Response.json(
        { error: "Contract must be in AWAITING_SIGNATURE status before sending for signature" },
        { status: 400 },
      )
    }

    if (!process.env.DOCUSEAL_API_KEY) {
      return Response.json({ error: "E-signature not configured" }, { status: 503 })
    }

    if (contract.docusealSubmissionId) {
      return Response.json(
        { error: "Submission already sent — cannot re-send" },
        { status: 409 },
      )
    }

    const signers = await prisma.contractSigner.findMany({
      where: { contractId: params.id },
      orderBy: { createdAt: "asc" },
    })

    if (signers.length === 0) {
      return Response.json(
        { error: "Add at least one signer before sending" },
        { status: 400 },
      )
    }

    // ── require a file ────────────────────────────────────────────────────────
    const file = await prisma.contractFile.findFirst({
      where: { contractId: params.id, isLatest: true },
      orderBy: { createdAt: "desc" },
    })

    if (!file) {
      return Response.json({ error: "No file attached to this contract" }, { status: 400 })
    }

    // ── download PDF bytes ────────────────────────────────────────────────────
    const downloadUrl = await storage.getSignedDownloadUrl(file.storageKey)
    const fileRes = await fetch(downloadUrl)
    if (!fileRes.ok) {
      return Response.json({ error: "Failed to download contract file" }, { status: 500 })
    }
    const arrayBuffer = await fileRes.arrayBuffer()
    const pdfBuffer = Buffer.from(arrayBuffer)

    // ── upload to DocuSeal as a template ──────────────────────────────────────
    const template = await createTemplate(contract.title, pdfBuffer)
    if (!template) {
      return Response.json({ error: "Failed to create DocuSeal template" }, { status: 500 })
    }

    // ── assign a unique role to each signer ───────────────────────────────────
    // DocuSeal requires every submitter in a submission to have a distinct role,
    // and each role must correspond to a field on the template.
    const signerRoles = signers.map((_, i) => `Signer ${i + 1}`)

    // ── add one signature field per role to the template ─────────────────────
    // Templates created from a PDF have no fields by default; DocuSeal will
    // reject a submission on a field-less template with 422.
    if (template.attachmentUuid) {
      const fieldsOk = await addFieldsToTemplate(template.id, template.attachmentUuid, signerRoles)
      if (!fieldsOk) {
        return Response.json({ error: "Failed to configure signing fields on template" }, { status: 500 })
      }
    }

    // ── create submission with ALL signers simultaneously ─────────────────────
    const submission = await createSubmission(
      template.id,
      signers.map((s, i) => ({ email: s.email, name: s.name, role: signerRoles[i] })),
    )

    if (!submission) {
      return Response.json({ error: "Failed to create DocuSeal submission" }, { status: 500 })
    }

    // ── match each signer to their DocuSeal submitter by index ────────────────
    // DocuSeal returns submitters in the same order they were sent.
    await prisma.$transaction([
      ...signers.map((signer, i) => {
        const submitter = submission.submitters[i]
        return prisma.contractSigner.update({
          where: { id: signer.id },
          data: {
            externalId: submitter?.slug ?? null,
            status: "pending",
          },
        })
      }),
      prisma.contract.update({
        where: { id: params.id },
        data: {
          docusealSubmissionId: String(submission.id),
          signingStatus: "sent",
          signingUrl: submission.submitters[0]?.embed_src ?? null,
        },
      }),
    ])

    await writeActivity(
      params.id,
      ctx.userId,
      "SENT_FOR_SIGNATURE",
      `Sent for signature to ${signers.length} signer(s)`,
    )

    return Response.json({ submissionId: submission.id, signingStatus: "sent" })
  })
}

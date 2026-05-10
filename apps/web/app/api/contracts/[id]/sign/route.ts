import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { storage } from "@/lib/storage"
import { createTemplate, createSubmission } from "@/lib/docuseal"
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit"

// ─── POST /api/contracts/[id]/sign ───────────────────────────────────────────
// Trigger DocuSeal signing flow for a contract that is AWAITING_SIGNATURE.

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  // Signing is irreversible — restrict to admin/legal roles.
  if (ctx.role !== "admin" && ctx.role !== "legal") {
    return Response.json(
      { error: "Only admin or legal roles may initiate signing" },
      { status: 403 },
    )
  }

  // Rate limit: 5 requests/min per org (signing is expensive + irreversible)
  const rl = await rateLimit(`${ctx.organizationId}:sign`, 5, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter)

  return requestContext.run(ctx, async () => {
    // ── org-scope check ───────────────────────────────────────────────────────
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        organizationId: true,
        title: true,
        status: true,
        counterpartyName: true,
        counterpartyContact: true,
        ownerId: true,
      },
    })

    if (!contract || contract.organizationId !== ctx.organizationId) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    // ── status guard ──────────────────────────────────────────────────────────
    if (contract.status !== "AWAITING_SIGNATURE") {
      return Response.json(
        { error: "Contract must be in AWAITING_SIGNATURE status" },
        { status: 400 },
      )
    }

    // ── DocuSeal configured? ──────────────────────────────────────────────────
    if (!process.env.DOCUSEAL_API_KEY) {
      return Response.json({ error: "E-signature not configured" }, { status: 503 })
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

    // ── determine signer ──────────────────────────────────────────────────────
    // Require an explicit counterparty email. The previous behavior silently
    // fell back to the org admin's email — which would route the signing
    // request to the wrong person, bypassing the intended signer flow.
    if (!contract.counterpartyContact) {
      return Response.json(
        {
          error: "missing_counterparty_contact",
          message:
            "Cannot initiate signing: counterparty email is not set on this contract.",
        },
        { status: 400 },
      )
    }
    const signerEmail = contract.counterpartyContact
    const signerName = contract.counterpartyName ?? "Signer"

    // ── create submission ─────────────────────────────────────────────────────
    const submission = await createSubmission(template.id, [
      { email: signerEmail, name: signerName },
    ])

    if (!submission) {
      return Response.json({ error: "Failed to create DocuSeal submission" }, { status: 500 })
    }

    const signingUrl = submission.submitters[0]?.embed_src ?? null

    // ── persist submission info ───────────────────────────────────────────────
    await prisma.contract.update({
      where: { id: params.id },
      data: {
        docusealSubmissionId: String(submission.id),
        signingUrl,
        signingStatus: "sent",
      },
    })

    await writeActivity(
      params.id,
      ctx.userId,
      "SENT_FOR_SIGNATURE",
      `Sent for signature to ${signerEmail}`,
    )

    return Response.json({ submissionId: submission.id, signingUrl, signingStatus: "sent" }, { status: 200 })
  })
}

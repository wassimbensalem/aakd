import { resolveAuth } from "@/lib/auth/middleware"
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

  // Rate limit: 5 requests/min per org (signing is expensive + irreversible)
  const rl = rateLimit(`${ctx.organizationId}:sign`, 5, 60_000)
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
    let signerEmail = contract.counterpartyContact ?? null
    let signerName = contract.counterpartyName ?? "Signer"

    if (!signerEmail) {
      // Fall back to org admin email
      const adminMember = await prisma.member.findFirst({
        where: { organizationId: ctx.organizationId, role: "admin" },
        select: { user: { select: { email: true, name: true } } },
      })
      signerEmail = adminMember?.user.email ?? ""
      signerName = adminMember?.user.name ?? "Signer"
    }

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
      },
    })

    await writeActivity(
      params.id,
      ctx.userId,
      "SENT_FOR_SIGNATURE",
      `Sent for signature to ${signerEmail}`,
    )

    return Response.json({ submissionId: submission.id, signingUrl }, { status: 200 })
  })
}

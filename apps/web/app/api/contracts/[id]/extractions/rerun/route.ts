import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requireRole } from "@/lib/auth/roles"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { getContractAiExtractQueue } from "@/lib/jobs/queues"

// ─── POST /api/contracts/[id]/extractions/rerun ───────────────────────────────
// Re-enqueues the AI extraction job for a contract using its stored extracted
// text. Works for any contract that has already been text-extracted (PDF/DOCX
// upload). Does not reset accepted extractions — only overwrites pending/
// rejected ones (same guard as the initial worker run).

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const roleError = requireRole(ctx.role, "member")
  if (roleError) return roleError
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  return requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true, extractedText: true },
    })

    if (!contract || contract.organizationId !== ctx.organizationId) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    if (!contract.extractedText) {
      return Response.json(
        { error: "no_text", message: "No extracted text found. Upload a document first." },
        { status: 422 },
      )
    }

    await getContractAiExtractQueue().add("ai_extract", {
      contractId: params.id,
      extractedText: contract.extractedText,
    })

    await writeActivity(
      params.id,
      ctx.userId,
      "METADATA_EXTRACTED",
      "AI extraction re-triggered manually",
    )

    return Response.json({ queued: true })
  })
}

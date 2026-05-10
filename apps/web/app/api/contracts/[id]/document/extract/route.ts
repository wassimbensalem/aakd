import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { contractAiExtractQueue } from "@/lib/jobs/queues"
import { plateToPlaintext } from "@/lib/editor/plate-to-plaintext"

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  if (ctx.role !== "admin" && ctx.role !== "legal") {
    return Response.json({ error: "forbidden" }, { status: 403 })
  }

  return requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true },
    })
    if (!contract) return new Response("Not Found", { status: 404 })

    const document = await prisma.contractDocument.findUnique({
      where: { contractId: params.id },
      select: { content: true },
    })
    if (!document) {
      return Response.json({ error: "no_document" }, { status: 422 })
    }

    const nodes = Array.isArray(document.content) ? (document.content as unknown[]) : []
    const plaintext = plateToPlaintext(nodes)

    if (!plaintext) {
      return Response.json({ error: "empty_document" }, { status: 422 })
    }

    await prisma.contract.update({
      where: { id: params.id },
      data: { extractedText: plaintext },
    })

    await contractAiExtractQueue.add("ai_extract", {
      contractId: params.id,
      extractedText: plaintext,
    })

    await writeActivity(
      params.id,
      ctx.userId,
      "METADATA_EXTRACTED",
      "Editor content sent for AI extraction",
    )

    return Response.json({ queued: true })
  })
}

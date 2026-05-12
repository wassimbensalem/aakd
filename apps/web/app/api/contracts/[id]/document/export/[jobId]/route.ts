import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { getDocumentExportQueue } from "@/lib/jobs/queues"

export async function GET(
  req: Request,
  { params }: { params: { id: string; jobId: string } },
) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true },
    })
    if (!contract || contract.organizationId !== ctx.organizationId) {
      return new Response("Not Found", { status: 404 })
    }

    const queue = getDocumentExportQueue()
    const job = await queue.getJob(params.jobId)
    if (!job) {
      return Response.json({ status: "failed", error: "job_not_found" })
    }

    if (job.data.requestedById !== ctx.userId || job.data.contractId !== params.id) {
      return new Response("Not Found", { status: 404 })
    }

    const state = await job.getState()
    if (state === "completed") {
      const ret = job.returnvalue as { downloadUrl?: string } | null
      return Response.json({
        status: "complete",
        downloadUrl: ret?.downloadUrl ?? null,
      })
    }
    if (state === "failed") {
      return Response.json({
        status: "failed",
        error: job.failedReason ?? "export_failed",
      })
    }
    return Response.json({ status: "pending" })
  })
}

import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { getDocumentConvertQueue } from "@/lib/jobs/queues"

export async function GET(
  req: Request,
  { params }: { params: { id: string; jobId: string } },
) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    // Verify the contract exists in the caller's org.
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true },
    })
    if (!contract) return new Response("Not Found", { status: 404 })

    const queue = getDocumentConvertQueue()
    const job = await queue.getJob(params.jobId)
    if (!job) {
      return Response.json({ status: "failed", error: "job_not_found" })
    }

    // Verify the requester originated this job.
    if (job.data.requestedById !== ctx.userId || job.data.contractId !== params.id) {
      return new Response("Not Found", { status: 404 })
    }

    const state = await job.getState()
    if (state === "completed") {
      return Response.json({ status: "complete" })
    }
    if (state === "failed") {
      return Response.json({
        status: "failed",
        error: job.failedReason ?? "conversion_failed",
      })
    }
    return Response.json({ status: "pending" })
  })
}

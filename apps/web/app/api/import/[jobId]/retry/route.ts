import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { enqueueImportProcess } from "@/lib/types/import-queue"
import { logger } from "@/lib/logger"

export async function POST(req: Request, { params }: { params: { jobId: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  return requestContext.run(ctx, async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const importJobModel = prisma.importJob
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const importRowModel = prisma.importRow
    if (!importJobModel || !importRowModel) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    const job = await importJobModel.findUnique({
      where: { id: params.jobId },
      select: { id: true, organizationId: true, status: true },
    })
    if (!job || job.organizationId !== ctx.organizationId) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    if (job.status !== "COMPLETED" && job.status !== "FAILED") {
      return Response.json({ error: "job_not_finished" }, { status: 422 })
    }

    await importJobModel.update({
      where: { id: job.id },
      data: { status: "PENDING", startedAt: null, completedAt: null },
    })

    await importRowModel.updateMany({
      where: { jobId: job.id, status: "failed" },
      data: { status: "pending", errorMessage: null },
    })

    try {
      await enqueueImportProcess({
        importJobId: job.id,
        organizationId: ctx.organizationId,
        createdById: ctx.userId,
      })
    } catch (err) {
      logger.error({ err, importJobId: job.id }, "[import.retry] enqueue failed")
    }

    return Response.json({ jobId: job.id }, { status: 202 })
  })
}

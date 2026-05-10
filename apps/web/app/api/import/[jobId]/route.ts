import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"

const FULL_ROW_THRESHOLD = 200

export async function GET(req: Request, { params }: { params: { jobId: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const importJobModel = (prisma as any).importJob
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const importRowModel = (prisma as any).importRow
    if (!importJobModel || !importRowModel) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    const job = await importJobModel.findUnique({
      where: { id: params.jobId },
      include: { createdBy: { select: { id: true, name: true } } },
    })
    if (!job || job.organizationId !== ctx.organizationId) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    const where =
      job.totalRows > FULL_ROW_THRESHOLD
        ? { jobId: job.id, status: "failed" }
        : { jobId: job.id }

    const rows = await importRowModel.findMany({
      where,
      orderBy: { rowIndex: "asc" },
      select: {
        id: true,
        rowIndex: true,
        sourceRef: true,
        status: true,
        errorMessage: true,
        contractId: true,
      },
    })

    return Response.json({ job, rows })
  })
}

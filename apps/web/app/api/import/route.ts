import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"

// GET /api/import — list import jobs for the org, paginated
export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const url = new URL(req.url)
    const page = (() => {
      const n = parseInt(url.searchParams.get("page") ?? "1", 10)
      return Number.isNaN(n) ? 1 : Math.max(1, n)
    })()
    const limit = (() => {
      const n = parseInt(url.searchParams.get("limit") ?? "20", 10)
      return Number.isNaN(n) ? 20 : Math.min(Math.max(1, n), 100)
    })()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const importJobModel = (prisma as any).importJob
    if (!importJobModel) {
      // Prisma client not yet regenerated for M10 — return empty list
      // gracefully instead of 500-ing the settings page.
      return Response.json({ jobs: [], total: 0, page, limit })
    }

    const where = { organizationId: ctx.organizationId }
    const [jobs, total] = await Promise.all([
      importJobModel.findMany({
        where,
        select: {
          id: true,
          source: true,
          status: true,
          totalRows: true,
          succeededRows: true,
          failedRows: true,
          createdAt: true,
          completedAt: true,
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      importJobModel.count({ where }),
    ])

    return Response.json({ jobs, total, page, limit })
  })
}

import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const url = new URL(req.url)

    // ── Pagination ──────────────────────────────────────────────────────────
    const page  = Math.max(1, parseInt(url.searchParams.get("page")  ?? "1",  10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20))

    // ── Filters ─────────────────────────────────────────────────────────────
    const action = url.searchParams.get("action") ?? undefined   // ActivityAction enum value
    const search = url.searchParams.get("search") ?? undefined   // actor label or contract title
    const days   = parseInt(url.searchParams.get("days") ?? "0", 10) // 7 | 30 | 90 | 0 = all

    const where: Record<string, unknown> = {
      contract: { organizationId: ctx.organizationId },
    }

    if (action) where.action = action
    if (days > 0) {
      where.createdAt = { gte: new Date(Date.now() - days * 86_400_000) }
    }
    if (search) {
      where.OR = [
        { actorLabel:  { contains: search, mode: "insensitive" } },
        { contract: { title: { contains: search, mode: "insensitive" } } },
      ]
    }

    const [activities, total] = await Promise.all([
      prisma.activity.findMany({
        where,
        include: {
          user:     { select: { id: true, name: true } },
          contract: { select: { id: true, title: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.activity.count({ where }),
    ])

    return Response.json({ activities, total, page, limit })
  })
}

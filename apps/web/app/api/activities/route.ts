import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const url = new URL(req.url)
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "10", 10)))

    const activities = await prisma.activity.findMany({
      where: {
        contract: { organizationId: ctx.organizationId },
      },
      include: {
        user: { select: { id: true, name: true } },
        contract: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    })

    return Response.json({ activities })
  })
}

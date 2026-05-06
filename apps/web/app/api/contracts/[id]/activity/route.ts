import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return new Response("Unauthorized", { status: 401 })

  return requestContext.run(ctx, async () => {
    const url = new URL(req.url)
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10))
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10)))

    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true },
    })
    if (!contract) return new Response("Not Found", { status: 404 })

    const [activities, total] = await Promise.all([
      prisma.activity.findMany({
        where: { contractId: params.id },
        include: { user: { select: { id: true, name: true, image: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.activity.count({ where: { contractId: params.id } }),
    ])

    return Response.json({ activities, total, page, limit })
  })
}

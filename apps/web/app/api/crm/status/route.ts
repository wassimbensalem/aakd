import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const rows = await prisma.crmIntegration.findMany({
      where: { organizationId: ctx.organizationId },
      select: {
        provider: true,
        createdAt: true,
        portalId: true,
        instanceUrl: true,
        autoCreateStage: true,
        syncOnActiveStage: true,
        connectedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    })

    const integrations = rows.map((r) => ({
      provider: r.provider,
      connectedAt: r.createdAt.toISOString(),
      connectedBy: { name: r.connectedBy?.name ?? "Unknown" },
      portalId: r.portalId,
      instanceUrl: r.instanceUrl,
      autoCreateStage: r.autoCreateStage,
      syncOnActiveStage: r.syncOnActiveStage,
    }))

    return Response.json({ integrations })
  })
}

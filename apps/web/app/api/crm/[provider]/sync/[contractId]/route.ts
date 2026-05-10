import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { getCrmProvider } from "@/lib/crm"
import { ensureFreshToken, normalizeProvider } from "@/lib/crm/route-helpers"

const ROLES_CAN_SYNC = new Set(["admin", "legal"])

export async function POST(
  req: Request,
  { params }: { params: { provider: string; contractId: string } },
) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  const provider = normalizeProvider(params.provider)
  if (!provider) return Response.json({ error: "invalid_provider" }, { status: 400 })

  if (!ROLES_CAN_SYNC.has(ctx.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  return requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findUnique({
      where: { id: params.contractId },
      select: { id: true, organizationId: true, status: true },
    })
    if (!contract || contract.organizationId !== ctx.organizationId) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    const link = await prisma.crmLink.findFirst({
      where: { contractId: params.contractId, provider },
      select: { id: true, externalDealId: true, integrationId: true },
    })
    if (!link) return Response.json({ error: "not_linked" }, { status: 404 })

    const integration = await prisma.crmIntegration.findUnique({
      where: { id: link.integrationId },
    })
    if (!integration) return Response.json({ error: "integration_missing" }, { status: 404 })

    let fresh
    try {
      fresh = await ensureFreshToken(integration)
    } catch (err) {
      console.error(`[crm.sync] ${provider} token refresh failed:`, err)
      await prisma.crmLink.update({
        where: { id: link.id },
        data: { lastSyncedAt: new Date(), lastSyncStatus: "token_refresh_failed" },
      })
      return Response.json({ error: "token_refresh_failed" }, { status: 502 })
    }

    let deal
    try {
      deal = await getCrmProvider(provider).getDeal(fresh, link.externalDealId)
    } catch (err) {
      console.error(`[crm.sync] ${provider} getDeal failed:`, err)
      await prisma.crmLink.update({
        where: { id: link.id },
        data: { lastSyncedAt: new Date(), lastSyncStatus: "fetch_failed" },
      })
      return Response.json({ error: "fetch_failed" }, { status: 502 })
    }

    if (!deal) {
      await prisma.crmLink.update({
        where: { id: link.id },
        data: { lastSyncedAt: new Date(), lastSyncStatus: "deal_not_found" },
      })
      return Response.json({ error: "deal_not_found" }, { status: 404 })
    }

    await prisma.crmLink.update({
      where: { id: link.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncStatus: "success",
        externalDealName: deal.name,
        externalDealUrl: deal.url,
      },
    })

    const targetStage = integration.syncOnActiveStage
    if (
      targetStage &&
      deal.stage &&
      deal.stage.toLowerCase() === targetStage.toLowerCase() &&
      contract.status !== "ACTIVE" &&
      contract.status !== "ARCHIVED"
    ) {
      await prisma.contract.update({
        where: { id: contract.id },
        data: { status: "ACTIVE" },
      })

      await writeActivity(
        contract.id,
        ctx.userId,
        "CRM_SYNCED",
        `Status set to ACTIVE from ${provider} deal stage "${deal.stage}"`,
        { provider, dealId: deal.id, newStage: deal.stage },
      ).catch((err) => console.error("[crm.sync] writeActivity error:", err))
    }

    return Response.json({ synced: true, deal })
  })
}

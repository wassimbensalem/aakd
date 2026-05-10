import type { CrmIntegration } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { getCrmProvider } from "@/lib/crm"
import { writeActivity } from "@/lib/db/activity"
import { normalizeProvider } from "@/lib/crm/route-helpers"

export async function POST(req: Request, { params }: { params: { provider: string } }) {
  const provider = normalizeProvider(params.provider)
  if (!provider || provider === "SALESFORCE") {
    // Salesforce doesn't post webhooks (polling only). Reject silently.
    return new Response(null, { status: 404 })
  }

  // HubSpot includes the portal id in headers. Use it to scope to a single
  // integration; otherwise we'd have to try every connected org's secret which
  // would also leak whether a portal id is connected here.
  let candidates: CrmIntegration[] = []
  if (provider === "HUBSPOT") {
    const portalId = req.headers.get("x-hubspot-portal-id")
    if (portalId) {
      candidates = await prisma.crmIntegration.findMany({
        where: { provider, portalId },
      })
    }
  }
  if (candidates.length === 0) {
    candidates = await prisma.crmIntegration.findMany({
      where: { provider },
      take: 50,
    })
  }
  if (candidates.length === 0) {
    // No org has this provider connected — accept silently so the CRM doesn't
    // disable our subscription for repeated 4xx responses.
    return new Response(null, { status: 200 })
  }

  // parseWebhookEvent consumes the body; clone the request once per candidate.
  let event = null
  let matched: CrmIntegration | null = null
  for (const candidate of candidates) {
    try {
      const cloned = req.clone()
      const parsed = await getCrmProvider(provider).parseWebhookEvent(cloned, candidate)
      if (parsed) {
        event = parsed
        matched = candidate
        break
      }
    } catch (err) {
      console.warn(`[crm.webhook] ${provider} parse failed for integration ${candidate.id}:`, err)
    }
  }

  if (!event || !matched) {
    return new Response(null, { status: 200 })
  }

  const links = await prisma.crmLink.findMany({
    where: {
      integrationId: matched.id,
      provider,
      externalDealId: event.dealId,
    },
    select: { id: true, contractId: true, contract: { select: { id: true, status: true } } },
  })

  for (const link of links) {
    const updates: { lastSyncedAt: Date; lastSyncStatus: string } = {
      lastSyncedAt: new Date(),
      lastSyncStatus: "success",
    }
    await prisma.crmLink.update({ where: { id: link.id }, data: updates })

    const targetStage = matched.syncOnActiveStage
    if (
      targetStage &&
      event.stage &&
      event.stage.toLowerCase() === targetStage.toLowerCase() &&
      link.contract.status !== "ACTIVE" &&
      link.contract.status !== "ARCHIVED"
    ) {
      await prisma.contract.update({
        where: { id: link.contractId },
        data: { status: "ACTIVE" },
      })

      await writeActivity(
        link.contractId,
        null,
        "CRM_SYNCED",
        `Status set to ACTIVE from ${provider} deal stage "${event.stage}"`,
        { provider, dealId: event.dealId, newStage: event.stage },
      ).catch((err) => console.error("[crm.webhook] writeActivity error:", err))
    }
  }

  return new Response(null, { status: 200 })
}

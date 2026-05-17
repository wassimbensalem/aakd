import type { CrmIntegration } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { requestContext } from "@/lib/context"
import { getCrmProvider } from "@/lib/crm"
import { writeActivity } from "@/lib/db/activity"
import { normalizeProvider } from "@/lib/crm/route-helpers"
import { logger } from "@/lib/logger"

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
      logger.warn({ err, provider, integrationId: candidate.id }, "[crm.webhook] parse failed for integration")
    }
  }

  if (!event || !matched) {
    return new Response(null, { status: 200 })
  }

  const matchedIntegration = matched
  // Establish a request context so the org-scope Prisma middleware injects
  // organizationId on the contract / crmLink writes below. Without this the
  // webhook handler would write outside the multi-tenancy guard.
  return requestContext.run(
    {
      organizationId: matchedIntegration.organizationId,
      userId: matchedIntegration.connectedById,
      role: "admin",
      scopes: ["read", "write"],
      source: "api_key",
    },
    async () => {
      const links = await prisma.crmLink.findMany({
        where: {
          integrationId: matchedIntegration.id,
          provider,
          externalDealId: event!.dealId,
        },
        select: {
          id: true,
          contractId: true,
          contract: { select: { id: true, status: true } },
        },
      })

      for (const link of links) {
        const updates: { lastSyncedAt: Date; lastSyncStatus: string } = {
          lastSyncedAt: new Date(),
          lastSyncStatus: "success",
        }
        await prisma.crmLink.update({ where: { id: link.id }, data: updates })

        const targetStage = matchedIntegration.syncOnActiveStage
        if (
          targetStage &&
          event!.stage &&
          event!.stage.toLowerCase() === targetStage.toLowerCase()
        ) {
          // State-machine guard: ACTIVE may only be entered from
          // AWAITING_SIGNATURE. Use update-with-where so concurrent updates
          // can't push DRAFT/PENDING_APPROVAL contracts straight to ACTIVE.
          try {
            await prisma.contract.update({
              where: { id: link.contractId, status: "AWAITING_SIGNATURE" },
              data: { status: "ACTIVE" },
            })

            // Audit trail — must not be fire-and-forget
            await writeActivity(
              link.contractId,
              null,
              "CRM_SYNCED",
              `Status set to ACTIVE from ${provider} deal stage "${event!.stage}"`,
              { provider, dealId: event!.dealId, newStage: event!.stage },
            )
          } catch (err) {
            // P2025: contract was not in AWAITING_SIGNATURE — silently skip.
            if ((err as { code?: string }).code !== "P2025") {
              throw err
            }
          }
        }
      }

      return new Response(null, { status: 200 })
    },
  )
}

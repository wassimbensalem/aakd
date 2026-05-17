import { z } from "zod"
import { Prisma } from "@prisma/client"
import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { getCrmProvider } from "@/lib/crm"
import { ensureFreshToken, normalizeProvider } from "@/lib/crm/route-helpers"
import { logger } from "@/lib/logger"

const ROLES_CAN_LINK = new Set(["admin", "legal", "member"])

// The UI sends `externalDealId`; some clients/spec use `dealId`. Accept either.
const LinkSchema = z.object({
  provider: z.enum(["HUBSPOT", "SALESFORCE", "PIPEDRIVE"]),
  externalDealId: z.string().min(1).optional(),
  dealId: z.string().min(1).optional(),
}).refine((v) => Boolean(v.externalDealId ?? v.dealId), {
  message: "externalDealId or dealId is required",
})

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true },
    })
    if (!contract || contract.organizationId !== ctx.organizationId) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    const links = await prisma.crmLink.findMany({
      where: { contractId: params.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        provider: true,
        externalDealId: true,
        externalDealName: true,
        externalDealUrl: true,
        lastSyncedAt: true,
        lastSyncStatus: true,
        createdAt: true,
        createdBy: { select: { name: true } },
        integration: { select: { provider: true } },
      },
    })

    return Response.json({
      links: links.map((l) => ({
        id: l.id,
        provider: l.provider,
        externalDealId: l.externalDealId,
        externalDealName: l.externalDealName,
        externalDealUrl: l.externalDealUrl,
        lastSyncedAt: l.lastSyncedAt?.toISOString() ?? null,
        lastSyncStatus: l.lastSyncStatus,
        createdAt: l.createdAt.toISOString(),
        createdBy: l.createdBy ? { name: l.createdBy.name } : null,
      })),
    })
  })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  if (!ROLES_CAN_LINK.has(ctx.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = LinkSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const provider = normalizeProvider(parsed.data.provider)
  if (!provider) return Response.json({ error: "invalid_provider" }, { status: 400 })

  const dealId = (parsed.data.externalDealId ?? parsed.data.dealId)!

  return requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true },
    })
    if (!contract || contract.organizationId !== ctx.organizationId) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    const integration = await prisma.crmIntegration.findUnique({
      where: { organizationId_provider: { organizationId: ctx.organizationId, provider } },
    })
    if (!integration) return Response.json({ error: "not_connected" }, { status: 404 })

    let fresh
    try {
      fresh = await ensureFreshToken(integration)
    } catch (err) {
      logger.error({ err, provider, contractId: params.id }, "[crm-link] token refresh failed")
      return Response.json({ error: "token_refresh_failed" }, { status: 502 })
    }

    let deal
    try {
      deal = await getCrmProvider(provider).getDeal(fresh, dealId)
    } catch (err) {
      logger.error({ err, provider, contractId: params.id, dealId }, "[crm-link] getDeal failed")
      return Response.json({ error: "deal_lookup_failed" }, { status: 502 })
    }
    if (!deal) return Response.json({ error: "deal_not_found" }, { status: 404 })

    let link
    try {
      link = await prisma.crmLink.create({
        data: {
          contractId: params.id,
          integrationId: integration.id,
          provider,
          externalDealId: deal.id,
          externalDealName: deal.name,
          externalDealUrl: deal.url,
          createdById: ctx.userId,
        },
        select: {
          id: true,
          provider: true,
          externalDealId: true,
          externalDealName: true,
          externalDealUrl: true,
          lastSyncedAt: true,
          lastSyncStatus: true,
          createdAt: true,
          createdBy: { select: { name: true } },
        },
      })
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return Response.json({ error: "already_linked" }, { status: 409 })
      }
      throw err
    }

    // Audit trail — must not be fire-and-forget
    await writeActivity(
      params.id,
      ctx.userId,
      "CRM_LINKED",
      `Linked to ${provider} deal: ${deal.name}`,
      { provider, dealId: deal.id, dealName: deal.name },
    )

    return Response.json(
      {
        link: {
          id: link.id,
          provider: link.provider,
          externalDealId: link.externalDealId,
          externalDealName: link.externalDealName,
          externalDealUrl: link.externalDealUrl,
          lastSyncedAt: link.lastSyncedAt?.toISOString() ?? null,
          lastSyncStatus: link.lastSyncStatus,
          createdAt: link.createdAt.toISOString(),
          createdBy: link.createdBy ? { name: link.createdBy.name } : null,
        },
      },
      { status: 201 },
    )
  })
}

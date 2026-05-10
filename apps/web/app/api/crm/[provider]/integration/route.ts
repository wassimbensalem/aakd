import { z } from "zod"
import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { normalizeProvider } from "@/lib/crm/route-helpers"

const SettingsSchema = z.object({
  autoCreateStage: z.string().max(200).nullable().optional(),
  syncOnActiveStage: z.string().max(200).nullable().optional(),
})

export async function PATCH(req: Request, { params }: { params: { provider: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const provider = normalizeProvider(params.provider)
  if (!provider) return Response.json({ error: "invalid_provider" }, { status: 400 })

  if (ctx.role !== "admin" && ctx.role !== "legal") {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = SettingsSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  return requestContext.run(ctx, async () => {
    const existing = await prisma.crmIntegration.findUnique({
      where: { organizationId_provider: { organizationId: ctx.organizationId, provider } },
      select: { id: true },
    })
    if (!existing) return Response.json({ error: "Not Found" }, { status: 404 })

    const updated = await prisma.crmIntegration.update({
      where: { id: existing.id },
      data: {
        autoCreateStage: parsed.data.autoCreateStage ?? null,
        syncOnActiveStage: parsed.data.syncOnActiveStage ?? null,
      },
      select: {
        provider: true,
        createdAt: true,
        portalId: true,
        instanceUrl: true,
        autoCreateStage: true,
        syncOnActiveStage: true,
        connectedBy: { select: { name: true } },
      },
    })

    return Response.json({
      provider: updated.provider,
      connectedAt: updated.createdAt.toISOString(),
      connectedBy: { name: updated.connectedBy?.name ?? "Unknown" },
      portalId: updated.portalId,
      instanceUrl: updated.instanceUrl,
      autoCreateStage: updated.autoCreateStage,
      syncOnActiveStage: updated.syncOnActiveStage,
    })
  })
}

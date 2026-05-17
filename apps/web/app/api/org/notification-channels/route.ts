import { z } from "zod"
import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requireRole } from "@/lib/auth/roles"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { encrypt } from "@/lib/notifications/crypto"
import { validateWebhookUrl } from "@/lib/notifications/validate-webhook-url"

const MAX_PER_TYPE = 5

const CreateChannelSchema = z.object({
  channelType: z.enum(["slack", "teams"]),
  webhookUrl: z.string().url().max(2048),
  label: z.string().min(1).max(100),
})

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const channels = await prisma.orgNotificationChannel.findMany({
      where: { organizationId: ctx.organizationId },
      select: {
        id: true,
        channelType: true,
        label: true,
        enabled: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    })
    return Response.json({ channels })
  })
}

export async function POST(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const writeCheck = requireWriteScope(ctx)
  if (writeCheck) return writeCheck

  const roleErr = requireRole(ctx.role, "admin")
  if (roleErr) return roleErr

  return requestContext.run(ctx, async () => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response("Invalid JSON", { status: 400 })
    }

    const parsed = CreateChannelSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    try {
      await validateWebhookUrl(parsed.data.webhookUrl)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Invalid webhook URL"
      return Response.json({ error: message }, { status: 422 })
    }

    const existingCount = await prisma.orgNotificationChannel.count({
      where: {
        organizationId: ctx.organizationId,
        channelType: parsed.data.channelType,
      },
    })
    if (existingCount >= MAX_PER_TYPE) {
      return Response.json({ error: "limit_reached" }, { status: 422 })
    }

    const channel = await prisma.orgNotificationChannel.create({
      data: {
        organizationId: ctx.organizationId,
        createdById: ctx.userId,
        channelType: parsed.data.channelType,
        webhookUrl: encrypt(parsed.data.webhookUrl),
        label: parsed.data.label,
      },
      select: {
        id: true,
        channelType: true,
        label: true,
        enabled: true,
        createdAt: true,
      },
    })

    return Response.json(channel, { status: 201 })
  })
}

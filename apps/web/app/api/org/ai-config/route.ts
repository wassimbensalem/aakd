import { resolveAuth } from "@/lib/auth/middleware"
import { hasRole } from "@/lib/auth/roles"
import { prisma } from "@/lib/db/client"
import { encrypt } from "@/lib/notifications/crypto"
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { z } from "zod"

const UpsertSchema = z.object({
  provider: z.enum(["anthropic", "openai"]),
  apiKey: z.string().min(1),
  model: z.string().optional(),
})

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return new Response("Unauthorized", { status: 401 })

  const rl = await rateLimit(`${ctx.organizationId}:ai-config-read`, 30, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter)

  const config = await prisma.orgAiConfig.findUnique({
    where: { organizationId: ctx.organizationId },
    select: { provider: true, model: true },
  })

  if (!config) {
    return Response.json({ provider: null, model: null, hasKey: false })
  }

  return Response.json({
    provider: config.provider,
    model: config.model,
    hasKey: true,
  })
}

export async function POST(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return new Response("Unauthorized", { status: 401 })

  if (!hasRole(ctx.role, "legal")) {
    return new Response("Forbidden", { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = UpsertSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { provider, apiKey, model } = parsed.data

  let encryptedKey: string
  try {
    encryptedKey = encrypt(apiKey)
  } catch (err) {
    console.error("[ai-config] Encryption failed:", err)
    return Response.json({ error: "Encryption not configured on this server" }, { status: 500 })
  }

  const config = await prisma.orgAiConfig.upsert({
    where: { organizationId: ctx.organizationId },
    create: {
      organizationId: ctx.organizationId,
      provider,
      encryptedKey,
      model: model ?? null,
    },
    update: {
      provider,
      encryptedKey,
      model: model ?? null,
    },
    select: { provider: true, model: true },
  })

  return Response.json({ provider: config.provider, model: config.model, hasKey: true }, { status: 200 })
}

export async function DELETE(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return new Response("Unauthorized", { status: 401 })

  if (!hasRole(ctx.role, "legal")) {
    return new Response("Forbidden", { status: 403 })
  }

  const rl = await rateLimit(`${ctx.organizationId}:ai-config-delete`, 10, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter)

  await prisma.orgAiConfig.deleteMany({
    where: { organizationId: ctx.organizationId },
  })

  return new Response(null, { status: 204 })
}

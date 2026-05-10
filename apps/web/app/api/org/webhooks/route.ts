import crypto from "node:crypto"
import { z } from "zod"
import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requireRole } from "@/lib/auth/roles"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { encrypt, decrypt } from "@/lib/notifications/crypto"

const MAX_PER_ORG = 10

const CreateWebhookSchema = z.object({
  url: z.string().url().max(2048),
  label: z.string().min(1).max(100),
})

function buildPreview(plaintextUrl: string): string {
  if (plaintextUrl.length <= 30) return plaintextUrl
  return `${plaintextUrl.slice(0, 30)}...`
}

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const rows = await prisma.outboundWebhook.findMany({
      where: { organizationId: ctx.organizationId },
      select: {
        id: true,
        url: true,
        label: true,
        enabled: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    })

    const webhooks = rows.map((row) => {
      let urlPreview = ""
      try {
        urlPreview = buildPreview(decrypt(row.url))
      } catch {
        urlPreview = "(decryption error)"
      }
      return {
        id: row.id,
        label: row.label,
        enabled: row.enabled,
        urlPreview,
        createdAt: row.createdAt,
      }
    })

    return Response.json({ webhooks })
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

    const parsed = CreateWebhookSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const existingCount = await prisma.outboundWebhook.count({
      where: { organizationId: ctx.organizationId },
    })
    if (existingCount >= MAX_PER_ORG) {
      return Response.json({ error: "limit_reached" }, { status: 422 })
    }

    const signingSecret = crypto.randomBytes(16).toString("hex")

    const webhook = await prisma.outboundWebhook.create({
      data: {
        organization: { connect: { id: ctx.organizationId } },
        createdBy: { connect: { id: ctx.userId } },
        url: encrypt(parsed.data.url),
        label: parsed.data.label,
        signingSecret: encrypt(signingSecret),
      },
      select: { id: true, label: true },
    })

    return Response.json(
      { id: webhook.id, label: webhook.label, signingSecret },
      { status: 201 },
    )
  })
}

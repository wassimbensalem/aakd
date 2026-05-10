import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { generateApiKey } from "@/lib/auth/api-keys"
import { requireRole } from "@/lib/auth/roles"
import { z } from "zod"

const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(["read", "write"])).default(["read"]),
  expiresAt: z.string().datetime().optional(),
})

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const roleErr = requireRole(ctx.role, "admin")
  if (roleErr) return roleErr

  return requestContext.run(ctx, async () => {
    const apiKeys = await prisma.apiKey.findMany({
      where: { organizationId: ctx.organizationId },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        createdById: true,
      },
      orderBy: { createdAt: "desc" },
    })
    return Response.json(apiKeys)
  })
}

export async function POST(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const roleErr = requireRole(ctx.role, "admin")
  if (roleErr) return roleErr

  return requestContext.run(ctx, async () => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response("Invalid JSON", { status: 400 })
    }

    const parsed = CreateApiKeySchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    // Cap keys per org so a compromised admin can't mint unlimited keys.
    const keyCount = await prisma.apiKey.count({
      where: { organizationId: ctx.organizationId },
    })
    if (keyCount >= 20) {
      return Response.json(
        { error: "api_key_limit_reached", limit: 20 },
        { status: 422 },
      )
    }

    const { raw, keyHash, lookupHash, prefix } = await generateApiKey()

    const apiKey = await prisma.apiKey.create({
      data: {
        name: parsed.data.name,
        keyHash,
        lookupHash,
        prefix,
        organization: { connect: { id: ctx.organizationId } },
        createdBy: { connect: { id: ctx.userId } },
        scopes: parsed.data.scopes,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
      },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        expiresAt: true,
        createdAt: true,
      },
    })

    return Response.json({ apiKey, rawKey: raw }, { status: 201 })
  })
}

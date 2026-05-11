import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { requireRole } from "@/lib/auth/roles"
import { z } from "zod"

const UpdateOrgSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  domain: z.string().max(200).optional(),
  timezone: z.string().max(100).optional(),
  industry: z.string().max(100).optional(),
  logo: z.string().url().optional().nullable(),
})

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const org = await prisma.organization.findUnique({
      where: { id: ctx.organizationId },
      include: { _count: { select: { members: true } } },
    })
    if (!org) return new Response("Not Found", { status: 404 })
    const meta = org.metadata ? (JSON.parse(org.metadata) as Record<string, unknown>) : {}
    return Response.json({ ...org, meta, logo: org.logo ?? null })
  })
}

export async function PATCH(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  const roleErr = requireRole(ctx.role, "admin")
  if (roleErr) return roleErr

  return requestContext.run(ctx, async () => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response("Invalid JSON", { status: 400 })
    }

    const parsed = UpdateOrgSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const existing = await prisma.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { metadata: true },
    })
    const meta = existing?.metadata
      ? (JSON.parse(existing.metadata) as Record<string, unknown>)
      : {}
    if (parsed.data.domain !== undefined) meta.domain = parsed.data.domain
    if (parsed.data.timezone !== undefined) meta.timezone = parsed.data.timezone
    if (parsed.data.industry !== undefined) meta.industry = parsed.data.industry

    const org = await prisma.organization.update({
      where: { id: ctx.organizationId },
      data: {
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...("logo" in parsed.data ? { logo: parsed.data.logo } : {}),
        metadata: JSON.stringify(meta),
      },
    })

    return Response.json({ ...org, meta, logo: org.logo ?? null })
  })
}

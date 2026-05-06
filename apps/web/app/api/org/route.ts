import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { requireRole } from "@/lib/auth/roles"
import { z } from "zod"

const UpdateOrgSchema = z.object({
  name: z.string().min(1).max(200).optional(),
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
    return Response.json(org)
  })
}

export async function PATCH(req: Request) {
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

    const parsed = UpdateOrgSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const org = await prisma.organization.update({
      where: { id: ctx.organizationId },
      data: { name: parsed.data.name },
    })

    return Response.json(org)
  })
}

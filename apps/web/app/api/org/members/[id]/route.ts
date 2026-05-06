import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { requireRole } from "@/lib/auth/roles"
import { z } from "zod"

const UpdateMemberSchema = z.object({
  role: z.enum(["admin", "legal", "member", "viewer"]),
})

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return new Response("Unauthorized", { status: 401 })

  const roleErr = requireRole(ctx.role, "admin")
  if (roleErr) return roleErr

  return requestContext.run(ctx, async () => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response("Invalid JSON", { status: 400 })
    }

    const parsed = UpdateMemberSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const member = await prisma.member.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true },
    })
    if (!member || member.organizationId !== ctx.organizationId) {
      return new Response("Not Found", { status: 404 })
    }

    const updated = await prisma.member.update({
      where: { id: params.id },
      data: { role: parsed.data.role },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
    })

    return Response.json(updated)
  })
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return new Response("Unauthorized", { status: 401 })

  const roleErr = requireRole(ctx.role, "admin")
  if (roleErr) return roleErr

  return requestContext.run(ctx, async () => {
    const member = await prisma.member.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true, organizationId: true },
    })
    if (!member || member.organizationId !== ctx.organizationId) {
      return new Response("Not Found", { status: 404 })
    }

    if (member.userId === ctx.userId) {
      return new Response("Cannot remove yourself", { status: 400 })
    }

    await prisma.member.delete({ where: { id: params.id } })

    return new Response(null, { status: 204 })
  })
}

import { z } from "zod"
import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requireRole } from "@/lib/auth/roles"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"

const UpdateChannelSchema = z
  .object({
    label: z.string().min(1).max(100).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((d) => d.label !== undefined || d.enabled !== undefined, {
    message: "At least one field is required",
  })

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const writeCheck = requireWriteScope(ctx)
  if (writeCheck) return writeCheck

  const roleErr = requireRole(ctx.role, "admin")
  if (roleErr) return roleErr

  return requestContext.run(ctx, async () => {
    const existing = await prisma.orgNotificationChannel.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true },
    })
    if (!existing || existing.organizationId !== ctx.organizationId) {
      return new Response("Not Found", { status: 404 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response("Invalid JSON", { status: 400 })
    }

    const parsed = UpdateChannelSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const updated = await prisma.orgNotificationChannel.update({
      where: { id: params.id },
      data: {
        ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
        ...(parsed.data.enabled !== undefined
          ? { enabled: parsed.data.enabled }
          : {}),
      },
      select: {
        id: true,
        channelType: true,
        label: true,
        enabled: true,
        createdAt: true,
      },
    })

    return Response.json(updated)
  })
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const writeCheck = requireWriteScope(ctx)
  if (writeCheck) return writeCheck

  const roleErr = requireRole(ctx.role, "admin")
  if (roleErr) return roleErr

  return requestContext.run(ctx, async () => {
    const existing = await prisma.orgNotificationChannel.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true },
    })
    if (!existing || existing.organizationId !== ctx.organizationId) {
      return new Response("Not Found", { status: 404 })
    }

    await prisma.orgNotificationChannel.delete({ where: { id: params.id } })
    return new Response(null, { status: 204 })
  })
}

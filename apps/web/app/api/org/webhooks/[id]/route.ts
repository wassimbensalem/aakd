import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requireRole } from "@/lib/auth/roles"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"

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
    const existing = await prisma.outboundWebhook.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true },
    })
    if (!existing || existing.organizationId !== ctx.organizationId) {
      return new Response("Not Found", { status: 404 })
    }

    await prisma.outboundWebhook.delete({ where: { id: params.id } })
    return new Response(null, { status: 204 })
  })
}

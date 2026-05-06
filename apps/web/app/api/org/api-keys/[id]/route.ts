import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { requireRole } from "@/lib/auth/roles"

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const roleErr = requireRole(ctx.role, "admin")
  if (roleErr) return roleErr

  return requestContext.run(ctx, async () => {
    const apiKey = await prisma.apiKey.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true, revokedAt: true },
    })

    if (!apiKey || apiKey.organizationId !== ctx.organizationId) {
      return new Response("Not Found", { status: 404 })
    }

    if (apiKey.revokedAt) {
      return new Response("API key already revoked", { status: 409 })
    }

    await prisma.apiKey.update({
      where: { id: params.id },
      data: { revokedAt: new Date() },
    })

    return new Response(null, { status: 204 })
  })
}

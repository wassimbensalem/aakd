import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const existing = await prisma.tag.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true },
    })
    // Middleware injects org scope into WHERE, so cross-org tags return null.
    // Explicit check here for defense-in-depth and code clarity.
    if (!existing || existing.organizationId !== ctx.organizationId)
      return Response.json({ error: "Not Found" }, { status: 404 })

    await prisma.tag.update({
      where: { id: params.id },
      data: { contracts: { set: [] } },
    })

    await prisma.tag.delete({ where: { id: params.id } })

    return new Response(null, { status: 204 })
  })
}

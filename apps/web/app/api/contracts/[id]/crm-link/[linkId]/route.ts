import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"

const ROLES_CAN_UNLINK = new Set(["admin", "legal"])

export async function DELETE(
  req: Request,
  { params }: { params: { id: string; linkId: string } },
) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  if (!ROLES_CAN_UNLINK.has(ctx.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  return requestContext.run(ctx, async () => {
    const link = await prisma.crmLink.findUnique({
      where: { id: params.linkId },
      select: {
        id: true,
        contractId: true,
        provider: true,
        externalDealId: true,
        contract: { select: { organizationId: true } },
      },
    })

    if (
      !link ||
      link.contractId !== params.id ||
      link.contract.organizationId !== ctx.organizationId
    ) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    await prisma.crmLink.delete({ where: { id: link.id } })

    await writeActivity(
      params.id,
      ctx.userId,
      "CRM_UNLINKED",
      `Unlinked from ${link.provider} deal`,
      { provider: link.provider, dealId: link.externalDealId },
    ).catch((err) => console.error("[crm-link] writeActivity error:", err))

    return new Response(null, { status: 204 })
  })
}

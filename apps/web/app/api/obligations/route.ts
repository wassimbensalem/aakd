import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import type { ObligationStatus } from "@/components/obligations/types"

const VALID_STATUSES = new Set<ObligationStatus>(["PENDING", "IN_PROGRESS", "COMPLETED", "OVERDUE"])

const USER_SELECT = { id: true, name: true, email: true } as const
const COMPLETED_BY_SELECT = { id: true, name: true } as const

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const url = new URL(req.url)
    const statusParam = url.searchParams.get("status")
    const q = url.searchParams.get("q")?.trim() ?? ""

    const statusFilter: ObligationStatus | undefined =
      statusParam && VALID_STATUSES.has(statusParam as ObligationStatus)
        ? (statusParam as ObligationStatus)
        : undefined

    const where = {
      contract: {
        organizationId: ctx.organizationId,
        status: { not: "ARCHIVED" as const },
      },
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
    }

    const obligations = await prisma.contractObligation.findMany({
      where,
      include: {
        assignee: { select: USER_SELECT },
        completedBy: { select: COMPLETED_BY_SELECT },
        createdBy: { select: COMPLETED_BY_SELECT },
        subTasks: {
          orderBy: { createdAt: "asc" },
          include: { completedBy: { select: COMPLETED_BY_SELECT } },
        },
        contract: {
          select: { id: true, title: true, counterpartyName: true },
        },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    })

    return Response.json({ obligations, total: obligations.length })
  })
}

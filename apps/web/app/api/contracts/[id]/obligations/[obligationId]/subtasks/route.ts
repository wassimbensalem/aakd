import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { z } from "zod"

const COMPLETED_BY_SELECT = { id: true, name: true } as const
const ROLES_CAN_WRITE = new Set(["admin", "legal", "member"])

const CreateSubTaskSchema = z.object({
  title: z.string().min(1).max(200),
})

export async function POST(
  req: Request,
  { params }: { params: { id: string; obligationId: string } },
) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError
  if (!ROLES_CAN_WRITE.has(ctx.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  return requestContext.run(ctx, async () => {
    // Org-scope guard. ContractObligation is org-scoped by middleware so
    // findUnique returns null for cross-tenant ids.
    const obligation = await prisma.contractObligation.findUnique({
      where: { id: params.obligationId },
      select: { id: true, contractId: true },
    })
    if (!obligation || obligation.contractId !== params.id) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 })
    }

    const parsed = CreateSubTaskSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const subTaskCount = await prisma.obligationSubTask.count({
      where: { obligationId: params.obligationId },
    })
    if (subTaskCount >= 20) {
      return Response.json({ error: "subtask_limit_reached" }, { status: 422 })
    }

    const subTask = await prisma.obligationSubTask.create({
      data: {
        obligationId: params.obligationId,
        title: parsed.data.title,
      },
      include: { completedBy: { select: COMPLETED_BY_SELECT } },
    })

    return Response.json(subTask, { status: 201 })
  })
}

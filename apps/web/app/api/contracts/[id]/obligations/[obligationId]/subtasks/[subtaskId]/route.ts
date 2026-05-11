import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { z } from "zod"

const COMPLETED_BY_SELECT = { id: true, name: true } as const
const ROLES_CAN_WRITE = new Set(["owner", "admin", "legal", "member"])

const PatchSubTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  isCompleted: z.boolean().optional(),
})

async function ensureSubTaskInScope(
  contractId: string,
  obligationId: string,
  subtaskId: string,
) {
  const obligation = await prisma.contractObligation.findUnique({
    where: { id: obligationId },
    select: { id: true, contractId: true },
  })
  if (!obligation || obligation.contractId !== contractId) return null
  const subTask = await prisma.obligationSubTask.findUnique({
    where: { id: subtaskId },
    select: { id: true, obligationId: true },
  })
  if (!subTask || subTask.obligationId !== obligationId) return null
  return subTask
}

export async function PATCH(
  req: Request,
  {
    params,
  }: { params: { id: string; obligationId: string; subtaskId: string } },
) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError
  if (!ROLES_CAN_WRITE.has(ctx.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  return requestContext.run(ctx, async () => {
    const subTask = await ensureSubTaskInScope(
      params.id,
      params.obligationId,
      params.subtaskId,
    )
    if (!subTask) return Response.json({ error: "Not Found" }, { status: 404 })

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 })
    }

    const parsed = PatchSubTaskSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const data = parsed.data

    const updated = await prisma.obligationSubTask.update({
      where: { id: params.subtaskId },
      data: {
        title: data.title,
        isCompleted: data.isCompleted,
        completedAt:
          data.isCompleted === true
            ? new Date()
            : data.isCompleted === false
              ? null
              : undefined,
        completedById:
          data.isCompleted === true
            ? ctx.userId
            : data.isCompleted === false
              ? null
              : undefined,
      },
      include: { completedBy: { select: COMPLETED_BY_SELECT } },
    })

    return Response.json(updated)
  })
}

export async function DELETE(
  req: Request,
  {
    params,
  }: { params: { id: string; obligationId: string; subtaskId: string } },
) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError
  if (!ROLES_CAN_WRITE.has(ctx.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  return requestContext.run(ctx, async () => {
    const subTask = await ensureSubTaskInScope(
      params.id,
      params.obligationId,
      params.subtaskId,
    )
    if (!subTask) return Response.json({ error: "Not Found" }, { status: 404 })

    await prisma.obligationSubTask.delete({ where: { id: params.subtaskId } })
    return new Response(null, { status: 204 })
  })
}

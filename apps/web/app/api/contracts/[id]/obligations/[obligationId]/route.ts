import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { z } from "zod"

const USER_SELECT = { id: true, name: true, email: true, image: true } as const
const COMPLETED_BY_SELECT = { id: true, name: true } as const

const ROLES_CAN_WRITE = new Set(["owner", "admin", "legal", "member"])
const ROLES_CAN_DELETE = new Set(["owner", "admin", "legal"])

const OBLIGATION_INCLUDE = {
  assignee: { select: USER_SELECT },
  completedBy: { select: COMPLETED_BY_SELECT },
  createdBy: { select: COMPLETED_BY_SELECT },
  subTasks: {
    orderBy: [{ createdAt: "asc" }] as { createdAt: "asc" }[],
    include: { completedBy: { select: COMPLETED_BY_SELECT } },
  },
}

// Status is restricted to PENDING/IN_PROGRESS/COMPLETED on the client path —
// OVERDUE is reserved for the daily cron so client clock skew can't bypass it.
const PatchObligationSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(2000).nullable().optional(),
  clauseReference: z.string().max(200).nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  dueDate: z.string().datetime().optional(),
  assigneeId: z.string().nullable().optional(),
  reminderDays: z.number().int().min(1).max(30).optional(),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED"]).optional(),
})

export async function GET(
  req: Request,
  { params }: { params: { id: string; obligationId: string } },
) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const obligation = await prisma.contractObligation.findUnique({
      where: { id: params.obligationId },
      include: {
        ...OBLIGATION_INCLUDE,
        contract: { select: { organizationId: true } },
      },
    })
    if (
      !obligation ||
      obligation.contractId !== params.id ||
      obligation.contract.organizationId !== ctx.organizationId
    ) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { contract: _contract, ...obligationData } = obligation
    return Response.json(obligationData)
  })
}

export async function PATCH(
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
    const existing = await prisma.contractObligation.findUnique({
      where: { id: params.obligationId },
      select: {
        id: true,
        contractId: true,
        status: true,
        title: true,
        contract: { select: { organizationId: true } },
      },
    })
    if (
      !existing ||
      existing.contractId !== params.id ||
      existing.contract.organizationId !== ctx.organizationId
    ) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 })
    }

    const parsed = PatchObligationSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const data = parsed.data

    if (data.assigneeId) {
      const assigneeMember = await prisma.member.findFirst({
        where: { userId: data.assigneeId, organizationId: ctx.organizationId },
        select: { userId: true },
      })
      if (!assigneeMember) {
        return Response.json({ error: "invalid_assignee" }, { status: 422 })
      }
    }

    const completing = data.status === "COMPLETED" && existing.status !== "COMPLETED"
    const reopening =
      data.status && data.status !== "COMPLETED" && existing.status === "COMPLETED"

    const updated = await prisma.contractObligation.update({
      where: { id: params.obligationId },
      data: {
        title: data.title,
        description: data.description === undefined ? undefined : data.description,
        clauseReference:
          data.clauseReference === undefined ? undefined : data.clauseReference,
        priority: data.priority,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        reminderSentAt: data.dueDate !== undefined ? null : undefined,
        assigneeId:
          data.assigneeId === undefined ? undefined : data.assigneeId,
        reminderDays: data.reminderDays,
        status: data.status,
        completedAt: completing ? new Date() : reopening ? null : undefined,
        completedById: completing ? ctx.userId : reopening ? null : undefined,
      },
      include: OBLIGATION_INCLUDE,
    })

    if (completing) {
      await writeActivity(
        params.id,
        ctx.userId,
        "OBLIGATION_COMPLETED",
        `Obligation completed: ${updated.title}`,
        { obligationId: updated.id },
      ).catch((err) => console.error("[obligations] writeActivity error:", err))
    } else {
      const changedFields = Object.keys(parsed.data).join(", ")
      await writeActivity(
        params.id,
        ctx.userId,
        "OBLIGATION_UPDATED",
        `Obligation updated: ${updated.title}${changedFields ? ` (${changedFields})` : ""}`,
        { obligationId: updated.id },
      ).catch((err) => console.error("[obligations] writeActivity error:", err))
    }

    return Response.json(updated)
  })
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string; obligationId: string } },
) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError
  if (!ROLES_CAN_DELETE.has(ctx.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  return requestContext.run(ctx, async () => {
    const existing = await prisma.contractObligation.findUnique({
      where: { id: params.obligationId },
      select: {
        id: true,
        contractId: true,
        title: true,
        contract: { select: { organizationId: true } },
      },
    })
    if (
      !existing ||
      existing.contractId !== params.id ||
      existing.contract.organizationId !== ctx.organizationId
    ) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    await prisma.contractObligation.delete({
      where: { id: params.obligationId },
    })

    await writeActivity(
      params.id,
      ctx.userId,
      "OBLIGATION_DELETED",
      `Obligation deleted: ${existing.title}`,
      { obligationId: existing.id },
    ).catch((err) => console.error("[obligations] writeActivity error:", err))

    return new Response(null, { status: 204 })
  })
}

import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { z } from "zod"

const USER_SELECT = { id: true, name: true, email: true, image: true } as const
const COMPLETED_BY_SELECT = { id: true, name: true } as const

const ROLES_CAN_WRITE = new Set(["owner", "admin", "legal", "member"])

const OBLIGATION_INCLUDE = {
  assignee: { select: USER_SELECT },
  completedBy: { select: COMPLETED_BY_SELECT },
  createdBy: { select: COMPLETED_BY_SELECT },
  subTasks: {
    orderBy: [{ createdAt: "asc" }] as { createdAt: "asc" }[],
    include: { completedBy: { select: COMPLETED_BY_SELECT } },
  },
}

const CreateObligationSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  clauseReference: z.string().max(200).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  dueDate: z.string().datetime(),
  assigneeId: z.string().optional(),
  reminderDays: z.number().int().min(1).max(30).default(7),
})

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true },
    })
    if (!contract || contract.organizationId !== ctx.organizationId) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    const obligations = await prisma.contractObligation.findMany({
      where: { contractId: params.id },
      include: OBLIGATION_INCLUDE,
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    })

    return Response.json({ obligations })
  })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  if (!ROLES_CAN_WRITE.has(ctx.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  return requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true, status: true },
    })
    if (!contract || contract.organizationId !== ctx.organizationId) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }
    if (contract.status === "ARCHIVED") {
      return Response.json({ error: "contract_archived" }, { status: 422 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 })
    }

    const parsed = CreateObligationSchema.safeParse(body)
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

    // Enforce active-obligation cap (PENDING + IN_PROGRESS only).
    const activeCount = await prisma.contractObligation.count({
      where: {
        contractId: params.id,
        status: { in: ["PENDING", "IN_PROGRESS"] },
      },
    })
    if (activeCount >= 100) {
      return Response.json({ error: "obligation_limit_reached" }, { status: 422 })
    }

    const obligation = await prisma.contractObligation.create({
      data: {
        contractId: params.id,
        organizationId: ctx.organizationId,
        title: data.title,
        description: data.description,
        clauseReference: data.clauseReference,
        priority: data.priority,
        dueDate: new Date(data.dueDate),
        assigneeId: data.assigneeId,
        reminderDays: data.reminderDays,
        createdById: ctx.userId,
      },
      include: OBLIGATION_INCLUDE,
    })

    await writeActivity(
      params.id,
      ctx.userId,
      "OBLIGATION_CREATED",
      `Obligation created: ${obligation.title}`,
      { obligationId: obligation.id },
    ).catch((err) => console.error("[obligations] writeActivity error:", err))

    return Response.json(obligation, { status: 201 })
  })
}

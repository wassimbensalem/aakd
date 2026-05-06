import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { z } from "zod"

// Allowed status transitions — prevents lifecycle corruption
const STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT:               ["INTERNAL_REVIEW", "ARCHIVED"],
  INTERNAL_REVIEW:     ["PENDING_APPROVAL", "DRAFT", "ARCHIVED"],
  PENDING_APPROVAL:    ["AWAITING_SIGNATURE", "INTERNAL_REVIEW", "ARCHIVED"],
  AWAITING_SIGNATURE:  ["ACTIVE", "ARCHIVED"],
  ACTIVE:              ["EXPIRED", "TERMINATED", "ARCHIVED"],
  EXPIRED:             ["ARCHIVED"],
  TERMINATED:          ["ARCHIVED"],
  ARCHIVED:            [], // terminal — no transitions out
}

const UpdateContractSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  contractType: z.enum(["NDA", "MSA", "SOW", "EMPLOYMENT", "VENDOR", "CUSTOMER", "OTHER"]).optional(),
  status: z.enum(["DRAFT", "INTERNAL_REVIEW", "PENDING_APPROVAL", "AWAITING_SIGNATURE", "ACTIVE", "EXPIRED", "TERMINATED", "ARCHIVED"]).optional(),
  counterpartyName: z.string().optional(),
  counterpartyContact: z.string().email().optional().or(z.literal("")),
  value: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  governingLaw: z.string().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  renewalDate: z.string().date().optional(),
  noticePeriodDays: z.number().int().min(0).optional(),
  autoRenewal: z.boolean().optional(),
  notes: z.string().max(10000).optional(),
  folderId: z.string().nullable().optional(),
  tagIds: z.array(z.string()).optional(),
})

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        tags: true,
        folder: true,
        files: { orderBy: { createdAt: "desc" }, take: 1 },
        versions: { orderBy: { version: "desc" } },
        activities: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { user: { select: { id: true, name: true, image: true } } },
        },
        _count: { select: { files: true, versions: true, activities: true } },
      },
    })

    if (!contract) return new Response("Not Found", { status: 404 })
    return Response.json(contract)
  })
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response("Invalid JSON", { status: 400 })
    }

    const parsed = UpdateContractSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const existing = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { status: true },
    })
    if (!existing) return new Response("Not Found", { status: 404 })

    // Validate status transition
    const { tagIds, startDate, endDate, renewalDate, status, ...rest } = parsed.data
    if (status && status !== existing.status) {
      const allowed = STATUS_TRANSITIONS[existing.status] ?? []
      if (!allowed.includes(status)) {
        return Response.json(
          { error: `Invalid transition: ${existing.status} → ${status}. Allowed: ${allowed.join(", ") || "none"}` },
          { status: 422 }
        )
      }
    }

    const updated = await prisma.contract.update({
      where: { id: params.id },
      data: {
        ...rest,
        status: status ?? undefined,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        renewalDate: renewalDate ? new Date(renewalDate) : undefined,
        tags: tagIds !== undefined ? { set: tagIds.map((id) => ({ id })) } : undefined,
      },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        tags: true,
        folder: true,
      },
    })

    const changedFields = Object.keys(parsed.data).join(", ")
    await writeActivity(params.id, ctx.userId, "UPDATED", changedFields)

    if (status && status !== existing.status) {
      await writeActivity(params.id, ctx.userId, "STATUS_CHANGED", `${existing.status} → ${status}`)
    }

    return Response.json(updated)
  })
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const existing = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, status: true },
    })
    if (!existing) return new Response("Not Found", { status: 404 })
    if (existing.status === "ARCHIVED") {
      return Response.json({ error: "Contract is already archived" }, { status: 409 })
    }

    await prisma.contract.update({
      where: { id: params.id },
      data: { status: "ARCHIVED" },
    })

    await writeActivity(params.id, ctx.userId, "ARCHIVED")

    return new Response(null, { status: 204 })
  })
}

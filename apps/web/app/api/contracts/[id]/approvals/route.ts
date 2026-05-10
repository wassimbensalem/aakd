import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { hasRole } from "@/lib/auth/roles"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { emailQueue } from "@/lib/jobs/queues"
import { enqueueNotification } from "@/lib/notifications/fanout"
import { z } from "zod"

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const

// ─── GET /api/contracts/[id]/approvals ───────────────────────────────────────
// Returns all approvals for a contract.

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

    const approvals = await prisma.approval.findMany({
      where: { contractId: params.id },
      include: {
        requestedBy: { select: USER_SELECT },
        assignedTo: { select: USER_SELECT },
      },
      orderBy: { createdAt: "asc" },
    })

    return Response.json({ approvals })
  })
}

// ─── POST /api/contracts/[id]/approvals ──────────────────────────────────────
// Request an approval. Only admin or legal roles may do this.

const PostSchema = z.object({
  assignedToId: z.string().min(1),
  message: z.string().optional(),
})

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  return requestContext.run(ctx, async () => {
    // Role gate: only legal+ (legal, admin, owner) can request approvals
    if (!hasRole(ctx.role, "legal")) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    // Org-scope check
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true, title: true, status: true },
    })
    if (!contract || contract.organizationId !== ctx.organizationId) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    // Validate body
    let body: z.infer<typeof PostSchema>
    try {
      body = PostSchema.parse(await req.json())
    } catch (err) {
      return Response.json({ error: "Invalid request body", detail: err }, { status: 400 })
    }

    // Block self-approval — separation of duties
    if (body.assignedToId === ctx.userId) {
      return Response.json({ error: "Cannot assign yourself as approver" }, { status: 400 })
    }

    // Resolve the assignee — must be a member of the same org
    const assigneeMember = await prisma.member.findFirst({
      where: { userId: body.assignedToId, organizationId: ctx.organizationId },
      include: { user: { select: USER_SELECT } },
    })
    if (!assigneeMember) {
      return Response.json({ error: "Assignee not found in this organization" }, { status: 400 })
    }

    // Resolve the requester for display purposes
    const requesterUser = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: USER_SELECT,
    })

    // Create the approval record
    const approval = await prisma.approval.create({
      data: {
        contractId: params.id,
        requestedById: ctx.userId,
        assignedToId: body.assignedToId,
        status: "pending",
      },
      include: {
        requestedBy: { select: USER_SELECT },
        assignedTo: { select: USER_SELECT },
      },
    })

    // Write audit activity
    await writeActivity(
      params.id,
      ctx.userId,
      "APPROVAL_REQUESTED",
      `Approval requested from ${assigneeMember.user.name}`,
    )

    // Advance contract status to PENDING_APPROVAL if currently DRAFT or INTERNAL_REVIEW
    if (contract.status === "DRAFT" || contract.status === "INTERNAL_REVIEW") {
      await prisma.contract.update({
        where: { id: params.id },
        data: { status: "PENDING_APPROVAL" },
      })
      await writeActivity(
        params.id,
        ctx.userId,
        "STATUS_CHANGED",
        `Status changed to PENDING_APPROVAL`,
        { from: contract.status, to: "PENDING_APPROVAL" },
      )
    }

    // Hand the email off to the email.send queue — fire-and-forget; the
    // worker handles SMTP latency and retries.
    emailQueue
      .add("send", {
        kind: "approval_request",
        to: assigneeMember.user.email,
        assigneeName: assigneeMember.user.name,
        requesterName: requesterUser?.name ?? "A team member",
        contractTitle: contract.title,
        message: body.message,
      })
      .catch(() => {})

    await enqueueNotification("approval.requested", params.id, ctx.userId, {
      approvalId: approval.id,
      assigneeId: assigneeMember.user.id,
      assigneeName: assigneeMember.user.name,
      requesterId: ctx.userId,
      requesterName: requesterUser?.name ?? "A team member",
      ...(body.message ? { message: body.message } : {}),
    })

    return Response.json({ approval }, { status: 201 })
  })
}

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
  step: z.number().int().positive().optional(),
  required: z.boolean().default(true).optional(),
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

    // Block approvals on contracts that are not in a requestable state
    const APPROVAL_REQUESTABLE = new Set(["DRAFT", "INTERNAL_REVIEW", "PENDING_APPROVAL"])
    if (!APPROVAL_REQUESTABLE.has(contract.status)) {
      return Response.json(
        { error: "Approvals cannot be requested on a contract in this state" },
        { status: 409 },
      )
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

    // Block duplicate active approval for the same assignee
    const existingActive = await prisma.approval.findFirst({
      where: {
        contractId: params.id,
        assignedToId: body.assignedToId,
        status: { in: ["pending", "waiting"] },
      },
    })
    if (existingActive) {
      return Response.json(
        { error: "This person already has an active approval on this contract" },
        { status: 409 },
      )
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

    // Only count "pending" *required* approvals to determine whether we're in an
    // active cycle. Optional approvals are always "pending" and must not push a
    // new required approver to a higher step or falsely signal an active chain.
    const pendingCount = await prisma.approval.count({
      where: { contractId: params.id, status: "pending", required: true },
    })
    const hasActivePending = pendingCount > 0

    // Determine step — caller override takes precedence; otherwise auto-assign.
    // Only count steps from *required* approvals so optional approvers (step 0)
    // never pollute the sequential numbering.
    const stepAgg = await prisma.approval.aggregate({
      where: { contractId: params.id, required: true },
      _max: { step: true },
    })
    const nextStep = body.step ?? (hasActivePending ? (stepAgg._max.step ?? 0) + 1 : 1)

    // Starting fresh: delete any stale "waiting" approvals left over from a
    // previous rejected cycle so activatedNext can't accidentally resurrect them.
    if (nextStep === 1) {
      await prisma.approval.deleteMany({
        where: { contractId: params.id, status: { in: ["waiting", "rejected"] } },
      })
    }

    // If this is not the first step (i.e. there's already a pending/active
    // approval in front of it) start in "waiting" so only the current active
    // reviewer gets notified. The PATCH handler activates the next step.
    // Required approvers follow the sequential chain (waiting if not first).
    // Optional approvers are always notified immediately (pending) and sit at
    // step 0 — outside the sequential chain — so they never shift the counter.
    const isRequired = body.required ?? true
    const approvalStatus = (!isRequired || nextStep === 1) ? "pending" : "waiting"
    // Optional approvers use step 0 (out-of-band); required ones use nextStep.
    const assignedStep = isRequired ? nextStep : 0

    // Create the approval record
    const approval = await prisma.approval.create({
      data: {
        contractId: params.id,
        requestedById: ctx.userId,
        assignedToId: body.assignedToId,
        status: approvalStatus,
        required: isRequired,
        step: assignedStep,
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

    // Only notify the assignee immediately if this approval is active ("pending").
    // "waiting" approvals are notified by the PATCH handler when they are activated.
    if (approvalStatus === "pending") {
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
    }

    return Response.json({ approval }, { status: 201 })
  })
}

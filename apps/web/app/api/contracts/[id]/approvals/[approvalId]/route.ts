import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { enqueueNotification } from "@/lib/notifications/fanout"
import { emailQueue } from "@/lib/jobs/queues"
import { z } from "zod"

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const

// ─── PATCH /api/contracts/[id]/approvals/[approvalId] ────────────────────────
// Decide on an approval. Only the assigned reviewer can approve or reject.

const PatchSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().optional(),
})

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; approvalId: string } },
) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  return requestContext.run(ctx, async () => {
    // Org-scope check on the contract
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true, status: true },
    })
    if (!contract || contract.organizationId !== ctx.organizationId) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    // Validate body
    let body: z.infer<typeof PatchSchema>
    try {
      body = PatchSchema.parse(await req.json())
    } catch (err) {
      return Response.json({ error: "Invalid request body", detail: err }, { status: 400 })
    }

    // Fetch the approval and verify it belongs to this contract
    const approval = await prisma.approval.findUnique({
      where: { id: params.approvalId },
      select: { id: true, contractId: true, assignedToId: true, status: true },
    })
    if (!approval || approval.contractId !== params.id) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    // Only the assigned reviewer may decide
    if (approval.assignedToId !== ctx.userId) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    // Reject re-decisions — approvals are write-once.
    if (approval.status !== "pending") {
      return Response.json({ error: "Approval already decided" }, { status: 409 })
    }

    // Decide approval, evaluate the gating condition, and (conditionally)
    // advance the contract status atomically. Two reviewers approving the
    // last pending approval at the same instant could otherwise both observe
    // "no unresolved" and double-advance.
    const { updated, advancedTo, activatedNext } = await prisma.$transaction(async (tx) => {
      const updated = await tx.approval.update({
        where: { id: params.approvalId },
        data: {
          status: body.decision,
          comment: body.comment ?? null,
          decidedAt: new Date(),
        },
        include: {
          requestedBy: { select: USER_SELECT },
          assignedTo: { select: USER_SELECT },
        },
      })

      let advancedTo: "AWAITING_SIGNATURE" | "INTERNAL_REVIEW" | null = null
      let activatedNext: { id: string; assignedToId: string } | null = null

      if (body.decision === "approved" && contract.status === "PENDING_APPROVAL") {
        // Activate the next step in the chain if it exists
        const nextWaiting = await tx.approval.findFirst({
          where: { contractId: params.id, status: "waiting" },
          orderBy: { step: "asc" },
        })
        if (nextWaiting) {
          await tx.approval.update({
            where: { id: nextWaiting.id },
            data: { status: "pending" },
          })
          activatedNext = { id: nextWaiting.id, assignedToId: nextWaiting.assignedToId }
        }

        // Only advance contract when ALL approvals are resolved (no pending/waiting/rejected)
        const unresolvedApprovals = await tx.approval.findMany({
          where: {
            contractId: params.id,
            status: { in: ["pending", "rejected", "waiting"] },
          },
          select: { id: true },
        })
        if (unresolvedApprovals.length === 0) {
          await tx.contract.update({
            where: { id: params.id, status: "PENDING_APPROVAL" },
            data: { status: "AWAITING_SIGNATURE" },
          })
          advancedTo = "AWAITING_SIGNATURE"
        }
      }

      if (body.decision === "rejected" && contract.status === "PENDING_APPROVAL") {
        await tx.contract.update({
          where: { id: params.id, status: "PENDING_APPROVAL" },
          data: { status: "INTERNAL_REVIEW" },
        })
        advancedTo = "INTERNAL_REVIEW"
      }

      return { updated, advancedTo, activatedNext }
    })

    // Side-effect audit writes — outside the transaction so a write failure
    // here cannot rewind the approval decision.
    const action = body.decision === "approved" ? "APPROVED" : "REJECTED"
    const detail = body.comment
      ? `${body.decision === "approved" ? "Approved" : "Rejected"}: ${body.comment}`
      : body.decision === "approved"
        ? "Approved"
        : "Rejected"
    await writeActivity(params.id, ctx.userId, action, detail)

    if (advancedTo === "AWAITING_SIGNATURE") {
      await writeActivity(
        params.id,
        ctx.userId,
        "STATUS_CHANGED",
        "PENDING_APPROVAL → AWAITING_SIGNATURE",
        { from: "PENDING_APPROVAL", to: "AWAITING_SIGNATURE" },
      )
    } else if (advancedTo === "INTERNAL_REVIEW") {
      await writeActivity(
        params.id,
        ctx.userId,
        "STATUS_CHANGED",
        "PENDING_APPROVAL → INTERNAL_REVIEW",
        { from: "PENDING_APPROVAL", to: "INTERNAL_REVIEW" },
      )
    }

    const decisionMetadata: Record<string, string | number | boolean | null> = {
      approvalId: approval.id,
      decidedById: ctx.userId,
      decidedByName: updated.assignedTo?.name ?? "Reviewer",
      ...(body.comment ? { comment: body.comment } : {}),
    }
    if (body.decision === "approved") {
      await enqueueNotification("approval.approved", params.id, ctx.userId, decisionMetadata)
    } else {
      await enqueueNotification("approval.rejected", params.id, ctx.userId, decisionMetadata)

      // Email the requester with the rejection reason
      const contractForEmail = await prisma.contract.findUnique({
        where: { id: params.id },
        select: { title: true },
      })
      emailQueue
        .add("send", {
          kind: "approval_rejected",
          to: updated.requestedBy.email,
          requesterName: updated.requestedBy.name,
          reviewerName: updated.assignedTo.name,
          contractTitle: contractForEmail?.title ?? "Contract",
          comment: body.comment,
        })
        .catch(() => {})
    }

    if (advancedTo === "AWAITING_SIGNATURE") {
      await enqueueNotification("contract.sent_for_signing", params.id, ctx.userId, {})
    }

    // Notify the next-in-chain approver that it is now their turn
    if (activatedNext) {
      const nextAssignee = await prisma.user.findUnique({
        where: { id: activatedNext.assignedToId },
        select: { id: true, name: true, email: true },
      })
      if (nextAssignee) {
        const contractForEmail = await prisma.contract.findUnique({
          where: { id: params.id },
          select: { title: true },
        })
        emailQueue
          .add("send", {
            kind: "approval_request",
            to: nextAssignee.email,
            assigneeName: nextAssignee.name,
            requesterName: updated.requestedBy?.name ?? "A team member",
            contractTitle: contractForEmail?.title ?? "Contract",
          })
          .catch(() => {})
        await enqueueNotification("approval.requested", params.id, ctx.userId, {
          approvalId: activatedNext.id,
          assigneeId: nextAssignee.id,
          assigneeName: nextAssignee.name,
          requesterId: ctx.userId,
          requesterName: updated.requestedBy?.name ?? "A team member",
        })
      }
    }

    return Response.json({ approval: updated })
  })
}

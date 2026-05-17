import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { hasRole } from "@/lib/auth/roles"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { enqueueNotification } from "@/lib/notifications/fanout"
import { emailQueue } from "@/lib/jobs/queues"
import { writeInApp } from "@/lib/notifications/write-in-app"
import { fireAndLog } from "@/lib/utils/fire-and-log"
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

    // Decide approval, evaluate the gating condition, and (conditionally)
    // advance the contract status atomically. Two reviewers approving the
    // last pending approval at the same instant could otherwise both observe
    // "no unresolved" and double-advance.
    // NOTE: The approval fetch and all status checks are INSIDE the transaction
    // so that concurrent requests cannot both pass the "pending" guard.
    let preCheckError: Response | null = null
    const { updated, advancedTo, activatedNext, approval } = await prisma.$transaction(async (tx) => {
      // Fetch the approval inside the transaction to prevent the race condition
      // where two concurrent requests both read "pending" before either updates it.
      const approval = await tx.approval.findUnique({
        where: { id: params.approvalId },
        select: { id: true, contractId: true, assignedToId: true, status: true, required: true },
      })
      if (!approval || approval.contractId !== params.id) {
        preCheckError = Response.json({ error: "Not Found" }, { status: 404 })
        return { updated: null, advancedTo: null, activatedNext: null, approval: null }
      }

      // Only the assigned reviewer may decide
      if (approval.assignedToId !== ctx.userId) {
        preCheckError = Response.json({ error: "Forbidden" }, { status: 403 })
        return { updated: null, advancedTo: null, activatedNext: null, approval: null }
      }

      // Reject re-decisions — approvals are write-once.
      if (approval.status !== "pending") {
        preCheckError = Response.json({ error: "Approval already decided" }, { status: 409 })
        return { updated: null, advancedTo: null, activatedNext: null, approval: null }
      }

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
      let activatedNext: { id: string; assignedToId: string; requestedBy: { id: string; name: string | null; email: string; image: string | null } } | null = null

      if (body.decision === "approved" && contract.status === "PENDING_APPROVAL") {
        // Activate the next step in the chain if it exists
        const nextWaiting = await tx.approval.findFirst({
          where: { contractId: params.id, status: "waiting" },
          orderBy: { step: "asc" },
          include: { requestedBy: { select: USER_SELECT } },
        })
        if (nextWaiting) {
          await tx.approval.update({
            where: { id: nextWaiting.id },
            data: { status: "pending" },
          })
          activatedNext = {
            id: nextWaiting.id,
            assignedToId: nextWaiting.assignedToId,
            requestedBy: nextWaiting.requestedBy,
          }
        }

        // Only advance contract when ALL *required* approvals are resolved
        const unresolvedRequired = await tx.approval.findMany({
          where: {
            contractId: params.id,
            required: true,
            status: { in: ["pending", "waiting"] },
          },
          select: { id: true },
        })
        const requiredApprovalCount = await tx.approval.count({
          where: { contractId: params.id, required: true },
        })
        if (unresolvedRequired.length === 0 && requiredApprovalCount > 0) {
          await tx.contract.update({
            where: { id: params.id, status: "PENDING_APPROVAL" },
            data: { status: "AWAITING_SIGNATURE" },
          })
          advancedTo = "AWAITING_SIGNATURE"
        }
      }

      if (body.decision === "rejected" && contract.status === "PENDING_APPROVAL") {
        // Only revert status if this was a required approver
        if (approval.required) {
          await tx.contract.update({
            where: { id: params.id, status: "PENDING_APPROVAL" },
            data: { status: "INTERNAL_REVIEW" },
          })
          advancedTo = "INTERNAL_REVIEW"
        }
      }

      return { updated, advancedTo, activatedNext, approval }
    })

    if (preCheckError) return preCheckError
    if (!updated || !approval) return Response.json({ error: "Not Found" }, { status: 404 })

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
      requesterId: updated.requestedBy.id,
      requesterName: updated.requestedBy.name ?? "Requester",
      ...(body.comment ? { comment: body.comment } : {}),
    }
    // contractTitle for in-app body — already fetched below for email, so fetch once now
    const contractForNotif = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { title: true },
    })
    const contractTitle = contractForNotif?.title ?? "Contract"

    if (body.decision === "approved") {
      fireAndLog(
        enqueueNotification("approval.approved", params.id, ctx.userId, decisionMetadata),
        "enqueueNotification:approval.approved",
      )
      // Write in-app notification directly — does not depend on worker being up
      await writeInApp(
        updated.requestedBy.id,
        ctx.organizationId,
        params.id,
        "approval.approved",
        "Approval approved",
        `${updated.assignedTo?.name ?? "Reviewer"} approved "${contractTitle}"`,
      )
    } else {
      fireAndLog(
        enqueueNotification("approval.rejected", params.id, ctx.userId, decisionMetadata),
        "enqueueNotification:approval.rejected",
      )
      // Write in-app notification directly — does not depend on worker being up
      await writeInApp(
        updated.requestedBy.id,
        ctx.organizationId,
        params.id,
        "approval.rejected",
        "Approval rejected",
        `${updated.assignedTo?.name ?? "Reviewer"} rejected "${contractTitle}"`,
      )

      // Email the requester with the rejection reason (reuse contractTitle fetched above)
      fireAndLog(
        emailQueue.add("send", {
          kind: "approval_rejected",
          to: updated.requestedBy.email,
          requesterName: updated.requestedBy.name,
          reviewerName: updated.assignedTo.name,
          contractTitle,
          comment: body.comment,
        }),
        "emailQueue:approval_rejected",
      )
    }

    if (advancedTo === "AWAITING_SIGNATURE") {
      fireAndLog(
        enqueueNotification("contract.sent_for_signing", params.id, ctx.userId, {}),
        "enqueueNotification:contract.sent_for_signing",
      )
    }

    // Notify the next-in-chain approver that it is now their turn.
    // Use activatedNext.requestedBy (the person who requested *that* step),
    // not updated.requestedBy (the person who requested the step just decided).
    if (activatedNext) {
      const nextAssignee = await prisma.user.findUnique({
        where: { id: activatedNext.assignedToId },
        select: { id: true, name: true, email: true },
      })
      if (nextAssignee) {
        const nextRequesterName = activatedNext.requestedBy?.name ?? "A team member"
        fireAndLog(
          emailQueue.add("send", {
            kind: "approval_request",
            to: nextAssignee.email,
            assigneeName: nextAssignee.name,
            requesterName: nextRequesterName,
            contractTitle,
          }),
          "emailQueue:approval_request:nextInChain",
        )
        fireAndLog(
          enqueueNotification("approval.requested", params.id, ctx.userId, {
            approvalId: activatedNext.id,
            assigneeId: nextAssignee.id,
            assigneeName: nextAssignee.name,
            requesterId: activatedNext.requestedBy?.id ?? ctx.userId,
            requesterName: nextRequesterName,
          }),
          "enqueueNotification:approval.requested:nextInChain",
        )
        // Write in-app notification directly for next-in-chain approver
        await writeInApp(
          nextAssignee.id,
          ctx.organizationId,
          params.id,
          "approval.requested",
          "Approval requested",
          `${nextRequesterName} asked you to approve "${contractTitle}"`,
        )
      }
    }

    return Response.json({ approval: updated })
  })
}

// ─── DELETE /api/contracts/[id]/approvals/[approvalId] ───────────────────────
// Cancel/withdraw a pending or waiting approval request.
// Only the original requester OR an admin/owner may cancel.
// Already-decided approvals (approved/rejected) cannot be cancelled.

export async function DELETE(
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

    const approval = await prisma.approval.findUnique({
      where: { id: params.approvalId },
      include: {
        assignedTo: { select: USER_SELECT },
        requestedBy: { select: USER_SELECT },
      },
    })
    if (!approval || approval.contractId !== params.id) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    // Only pending or waiting approvals can be cancelled
    if (approval.status !== "pending" && approval.status !== "waiting") {
      return Response.json(
        { error: "Only pending or waiting approvals can be cancelled" },
        { status: 409 },
      )
    }

    // Only the original requester or an admin/owner may cancel
    const isRequester = approval.requestedById === ctx.userId
    const isAdminOrOwner = hasRole(ctx.role, "admin")
    if (!isRequester && !isAdminOrOwner) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    const assigneeName = approval.assignedTo.name ?? "Reviewer"

    await prisma.$transaction(async (tx) => {
      await tx.approval.delete({ where: { id: params.approvalId } })

      // If this was the only pending *required* approval, revert contract to INTERNAL_REVIEW.
      // Filter for required: true so optional approvals (step=0) don't block the revert.
      if (approval.status === "pending" && contract.status === "PENDING_APPROVAL") {
        const otherPending = await tx.approval.count({
          where: {
            contractId: params.id,
            status: "pending",
            required: true,
            id: { not: params.approvalId },
          },
        })
        if (otherPending === 0) {
          await tx.contract.update({
            where: { id: params.id },
            data: { status: "INTERNAL_REVIEW" },
          })
        }
      }
    })

    await writeActivity(
      params.id,
      ctx.userId,
      "APPROVAL_CANCELLED",
      `Approval request for ${assigneeName} was cancelled`,
    )

    return Response.json({ success: true })
  })
}

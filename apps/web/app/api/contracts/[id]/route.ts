import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requireRole } from "@/lib/auth/roles"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { generateAlertsForContract } from "@/lib/alerts/generate"
import { enqueueNotification } from "@/lib/notifications/fanout"
import { fireAndLog } from "@/lib/utils/fire-and-log"
import { SECURE_HEADERS } from "@/lib/api-headers"
import { requestLogger } from "@/lib/logger"
import { z } from "zod"

// Allowed status transitions — all forward and backward moves permitted so
// users can correct mistakes freely. Only ARCHIVED is semi-terminal (can
// return to DRAFT to unarchive, but not to mid-flow states).
const ALL_STATUSES = ["DRAFT","INTERNAL_REVIEW","PENDING_APPROVAL","AWAITING_SIGNATURE","ACTIVE","EXPIRED","TERMINATED","ARCHIVED"] as const
const STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT:               ALL_STATUSES.filter((s) => s !== "DRAFT"),
  INTERNAL_REVIEW:     ALL_STATUSES.filter((s) => s !== "INTERNAL_REVIEW"),
  PENDING_APPROVAL:    ALL_STATUSES.filter((s) => s !== "PENDING_APPROVAL"),
  AWAITING_SIGNATURE:  ALL_STATUSES.filter((s) => s !== "AWAITING_SIGNATURE"),
  ACTIVE:              ["EXPIRED", "TERMINATED", "ARCHIVED"], // once active, only forward moves allowed
  EXPIRED:             ALL_STATUSES.filter((s) => s !== "EXPIRED"),
  TERMINATED:          ALL_STATUSES.filter((s) => s !== "TERMINATED"),
  ARCHIVED:            ["DRAFT"], // unarchive → back to draft only
}

const isoDate = z.union([z.string().date(), z.string().datetime({ offset: true })])

const UpdateContractSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  contractType: z.enum(["NDA", "MSA", "SOW", "EMPLOYMENT", "VENDOR", "CUSTOMER", "OTHER"]).nullable().optional(),
  status: z.enum(["DRAFT", "INTERNAL_REVIEW", "PENDING_APPROVAL", "AWAITING_SIGNATURE", "ACTIVE", "EXPIRED", "TERMINATED", "ARCHIVED"]).optional(),
  counterpartyName: z.string().nullable().optional(),
  counterpartyContact: z.string().email().or(z.literal("")).nullable().optional(),
  value: z.number().positive().nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  governingLaw: z.string().nullable().optional(),
  startDate: isoDate.nullable().optional(),
  endDate: isoDate.nullable().optional(),
  renewalDate: isoDate.nullable().optional(),
  noticePeriodDays: z.number().int().min(0).nullable().optional(),
  autoRenewal: z.boolean().optional(),
  notes: z.string().max(10000).nullable().optional(),
  folderId: z.string().nullable().optional(),
  tagIds: z.array(z.string()).optional(),
})

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        title: true,
        contractType: true,
        status: true,
        ownerId: true,
        counterpartyName: true,
        counterpartyContact: true,
        value: true,
        currency: true,
        governingLaw: true,
        startDate: true,
        endDate: true,
        renewalDate: true,
        noticePeriodDays: true,
        autoRenewal: true,
        notes: true,
        organizationId: true,
        folderId: true,
        docusealSubmissionId: true,
        signingUrl: true,
        signingStatus: true,
        createdAt: true,
        updatedAt: true,
        owner: { select: { id: true, name: true, email: true, image: true } },
        tags: true,
        folder: true,
        files: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            filename: true,
            sizeBytes: true,
            mimeType: true,
            isLatest: true,
            createdAt: true,
          },
        },
        versions: { orderBy: { version: "desc" } },
        activities: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { user: { select: { id: true, name: true, image: true } } },
        },
        _count: { select: { files: true, versions: true, activities: true } },
      },
    })

    if (!contract || contract.organizationId !== ctx.organizationId) {
      return new Response("Not Found", { status: 404 })
    }

    // The detail page only needs to know if extractedText exists (to gate the
    // Ask AI panel) — /ask fetches the real text. Keep the response light by
    // only fetching a presence flag.
    const presence = await prisma.contract.count({
      where: { id: params.id, extractedText: { not: null } },
    })

    return Response.json({ ...contract, hasExtractedText: presence > 0 }, { headers: SECURE_HEADERS })
  })
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const log = requestLogger(ctx.requestId)

  const roleError = requireRole(ctx.role, "legal")
  if (roleError) return roleError
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

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

    let existing: { id: string; status: string; endDate: Date | null; renewalDate: Date | null; noticePeriodDays: number | null } | null
    try {
      existing = await prisma.contract.findUnique({
        where: { id: params.id },
        select: { id: true, status: true, endDate: true, renewalDate: true, noticePeriodDays: true },
      })
    } catch (err) {
      log.error({ err, contractId: params.id }, "[PATCH /contracts/:id] findUnique error")
      return Response.json({ error: "Database error looking up contract" }, { status: 500 })
    }
    if (!existing) return new Response("Not Found", { status: 404 })

    // Validate status transition
    const { tagIds, folderId, startDate, endDate, renewalDate, status, ...rest } = parsed.data

    // Strip any HTML tags from free-text fields to prevent XSS persistence
    const stripHtml = (s: string) => s.replace(/<[^>]*>/g, "")
    if (rest.counterpartyName) rest.counterpartyName = stripHtml(rest.counterpartyName)
    if (rest.notes) rest.notes = stripHtml(rest.notes)
    if (rest.governingLaw) rest.governingLaw = stripHtml(rest.governingLaw)

    if (status && status !== existing.status) {
      const allowed = STATUS_TRANSITIONS[existing.status] ?? []
      if (!allowed.includes(status)) {
        return Response.json(
          { error: `Invalid transition: ${existing.status} → ${status}. Allowed: ${allowed.join(", ") || "none"}` },
          { status: 422 }
        )
      }

      // Guard: PENDING_APPROVAL → AWAITING_SIGNATURE only if all approvals resolved
      if (existing.status === "PENDING_APPROVAL" && status === "AWAITING_SIGNATURE") {
        const openApprovals = await prisma.approval.count({
          where: { contractId: existing.id, status: { in: ["pending", "rejected"] } },
        })
        if (openApprovals > 0) {
          return Response.json(
            { error: "Cannot advance to signing while approvals are pending or rejected" },
            { status: 422 }
          )
        }
      }
    }

    // Verify folder + tags belong to the caller's org before connecting them.
    if (folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: folderId, organizationId: ctx.organizationId },
        select: { id: true },
      })
      if (!folder) {
        return Response.json({ error: "Folder not found in this organization" }, { status: 400 })
      }
    }
    if (tagIds && tagIds.length > 0) {
      const found = await prisma.tag.findMany({
        where: { id: { in: tagIds }, organizationId: ctx.organizationId },
        select: { id: true },
      })
      if (found.length !== tagIds.length) {
        return Response.json({ error: "One or more tags not found in this organization" }, { status: 400 })
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let updated: any
    try {
      updated = await prisma.contract.update({
        where: { id: params.id },
        data: {
          ...rest,
          status: status ?? undefined,
          folderId: folderId === undefined ? undefined : folderId,
          startDate: startDate === undefined ? undefined : startDate ? new Date(startDate) : null,
          endDate: endDate === undefined ? undefined : endDate ? new Date(endDate) : null,
          renewalDate: renewalDate === undefined ? undefined : renewalDate ? new Date(renewalDate) : null,
          tags: tagIds !== undefined ? { set: tagIds.map((id) => ({ id })) } : undefined,
        },
        include: {
          owner: { select: { id: true, name: true, email: true, image: true } },
          tags: true,
          folder: true,
        },
      })
    } catch (err) {
      log.error({ err, contractId: params.id }, "[PATCH /contracts/:id] update error")
      return Response.json({ error: "Database error updating contract" }, { status: 500 })
    }

    const changedFields = Object.keys(parsed.data).join(", ")
    // Audit trail — must not be fire-and-forget
    await writeActivity(params.id, ctx.userId, "UPDATED", changedFields)

    if (status && status !== existing.status) {
      // Audit trail — must not be fire-and-forget
      await writeActivity(params.id, ctx.userId, "STATUS_CHANGED", `${existing.status} → ${status}`)
      if (status === "AWAITING_SIGNATURE") {
        fireAndLog(
          enqueueNotification("contract.sent_for_signing", params.id, ctx.userId, {}),
          "enqueueNotification:contract.sent_for_signing",
        )
      } else if (status === "ARCHIVED") {
        fireAndLog(
          enqueueNotification("contract.archived", params.id, ctx.userId, {}),
          "enqueueNotification:contract.archived",
        )
      }
    }

    // Regenerate renewal alerts if any date-related field changed
    const dateFieldsTouched =
      endDate !== undefined ||
      renewalDate !== undefined ||
      parsed.data.noticePeriodDays !== undefined

    if (dateFieldsTouched) {
      // Merge patched values over existing values
      const resolvedEndDate = endDate
        ? new Date(endDate)
        : existing.endDate ?? null
      const resolvedRenewalDate = renewalDate
        ? new Date(renewalDate)
        : existing.renewalDate ?? null
      const resolvedNoticePeriodDays =
        parsed.data.noticePeriodDays !== undefined
          ? parsed.data.noticePeriodDays
          : existing.noticePeriodDays ?? null

      fireAndLog(
        generateAlertsForContract(
          params.id,
          resolvedEndDate,
          resolvedRenewalDate,
          resolvedNoticePeriodDays,
        ),
        "generateAlertsForContract:contractUpdated",
      )
    }

    return Response.json(updated)
  })
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const roleError = requireRole(ctx.role, "legal")
  if (roleError) return roleError
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

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

    // Audit trail — must not be fire-and-forget
    await writeActivity(params.id, ctx.userId, "ARCHIVED")

    fireAndLog(
      enqueueNotification("contract.archived", params.id, ctx.userId, {}),
      "enqueueNotification:contract.archived",
    )

    return new Response(null, { status: 204 })
  })
}

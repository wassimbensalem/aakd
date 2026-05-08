import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { generateAlertsForContract } from "@/lib/alerts/generate"
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
        createdAt: true,
        updatedAt: true,
        owner: { select: { id: true, name: true, email: true } },
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

    if (!contract) return new Response("Not Found", { status: 404 })

    // The detail page only needs to know if extractedText exists (to gate the
    // Ask AI panel) — /ask fetches the real text. Keep the response light by
    // only fetching a presence flag.
    const presence = await prisma.contract.count({
      where: { id: params.id, extractedText: { not: null } },
    })

    return Response.json({ ...contract, hasExtractedText: presence > 0 })
  })
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
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

    let existing: { status: string; endDate: Date | null; renewalDate: Date | null; noticePeriodDays: number | null } | null
    try {
      existing = await prisma.contract.findUnique({
        where: { id: params.id },
        select: { status: true, endDate: true, renewalDate: true, noticePeriodDays: true },
      })
    } catch (err) {
      console.error("[PATCH /contracts/:id] findUnique error:", err)
      return Response.json({ error: "Database error looking up contract" }, { status: 500 })
    }
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let updated: any
    try {
      updated = await prisma.contract.update({
        where: { id: params.id },
        data: {
          ...rest,
          status: status ?? undefined,
          startDate: startDate === undefined ? undefined : startDate ? new Date(startDate) : null,
          endDate: endDate === undefined ? undefined : endDate ? new Date(endDate) : null,
          renewalDate: renewalDate === undefined ? undefined : renewalDate ? new Date(renewalDate) : null,
          tags: tagIds !== undefined ? { set: tagIds.map((id) => ({ id })) } : undefined,
        },
        include: {
          owner: { select: { id: true, name: true, email: true } },
          tags: true,
          folder: true,
        },
      })
    } catch (err) {
      console.error("[PATCH /contracts/:id] update error:", err)
      return Response.json({ error: "Database error updating contract" }, { status: 500 })
    }

    const changedFields = Object.keys(parsed.data).join(", ")
    await writeActivity(params.id, ctx.userId, "UPDATED", changedFields).catch((err) =>
      console.error("[PATCH /contracts/:id] writeActivity UPDATED error:", err)
    )

    if (status && status !== existing.status) {
      await writeActivity(params.id, ctx.userId, "STATUS_CHANGED", `${existing.status} → ${status}`).catch((err) =>
        console.error("[PATCH /contracts/:id] writeActivity STATUS_CHANGED error:", err)
      )
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

      await generateAlertsForContract(
        params.id,
        resolvedEndDate,
        resolvedRenewalDate,
        resolvedNoticePeriodDays
      ).catch((err) => console.error("[alerts] generateAlertsForContract failed:", err))
    }

    return Response.json(updated)
  })
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
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

    await writeActivity(params.id, ctx.userId, "ARCHIVED")

    return new Response(null, { status: 204 })
  })
}

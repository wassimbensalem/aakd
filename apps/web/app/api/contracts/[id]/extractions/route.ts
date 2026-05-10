import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { generateAlertsForContract } from "@/lib/alerts/generate"
import { z } from "zod"
import type { ContractType } from "@prisma/client"

// Fields whose acceptance must trigger renewal-alert regeneration
const ALERT_TRIGGERING_FIELDS = new Set(["endDate", "renewalDate", "noticePeriodDays"])

async function regenerateAlertsIfTouched(contractId: string, touchedFields: string[]) {
  if (!touchedFields.some((f) => ALERT_TRIGGERING_FIELDS.has(f))) return
  const c = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { endDate: true, renewalDate: true, noticePeriodDays: true },
  })
  if (!c) return
  await generateAlertsForContract(
    contractId,
    c.endDate,
    c.renewalDate,
    c.noticePeriodDays,
  ).catch((err) =>
    console.error("[alerts] generateAlertsForContract failed after extraction accept:", err),
  )
}

// ─── GET /api/contracts/[id]/extractions ─────────────────────────────────────
// Returns all AIExtraction records for the contract, ordered by createdAt.

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

    const extractions = await prisma.aIExtraction.findMany({
      where: { contractId: params.id },
      orderBy: { createdAt: "asc" },
    })

    return Response.json({ extractions })
  })
}

// ─── PATCH /api/contracts/[id]/extractions ────────────────────────────────────
// Actions:
//   { action: "accept",     extractionId: string }           — mark accepted + write to contract
//   { action: "reject",     extractionId: string }           — mark rejected
//   { action: "edit",       extractionId: string, newValue } — update rawValue then accept
//   { action: "accept_all" }                                 — bulk accept all pending extractions

const PatchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"),     extractionId: z.string().min(1) }),
  z.object({ action: z.literal("reject"),     extractionId: z.string().min(1) }),
  z.object({ action: z.literal("edit"),       extractionId: z.string().min(1), newValue: z.string().min(1) }),
  z.object({ action: z.literal("accept_all") }),
])

// Map of extraction field name → canonical Contract column + type coercion
type CoerceFn = (raw: string) => unknown
const FIELD_MAP: Record<string, { column: string; coerce: CoerceFn }> = {
  contractType:     { column: "contractType",     coerce: (v) => v as ContractType },
  startDate:        { column: "startDate",         coerce: (v) => new Date(v) },
  endDate:          { column: "endDate",           coerce: (v) => new Date(v) },
  renewalDate:      { column: "renewalDate",       coerce: (v) => new Date(v) },
  value:            { column: "value",             coerce: (v) => parseFloat(v) },
  currency:         { column: "currency",          coerce: (v) => v },
  counterpartyName: { column: "counterpartyName",  coerce: (v) => v },
  governingLaw:     { column: "governingLaw",      coerce: (v) => v },
  noticePeriodDays: { column: "noticePeriodDays",  coerce: (v) => parseInt(v, 10) },
  autoRenewal:      { column: "autoRenewal",       coerce: (v) => v === "true" || v === "1" },
}

/**
 * Returns true if the coerced value is safe to write. NaN floats, NaN ints,
 * and Invalid Date objects all coerce silently in JS but Prisma will either
 * reject them or — worse — persist nonsense like NaN/null.
 */
function isCoercedValueValid(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value)
  if (value instanceof Date) return !Number.isNaN(value.getTime())
  return value !== undefined
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  return requestContext.run(ctx, async () => {
    // Org-scope check
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true },
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

    // ── accept_all ────────────────────────────────────────────────────────────
    if (body.action === "accept_all") {
      // Snapshot + writes run inside a single interactive transaction to close
      // the TOCTOU window where new pending extractions could slip between the
      // findMany and the updateMany, ending up accepted=true but not written.
      let accepted: number | { count: number; updatedFields: string[] }
      try {
        accepted = await prisma.$transaction(async (tx) => {
        const pending = await tx.aIExtraction.findMany({
          where: { contractId: params.id, status: "pending" },
          select: { id: true, field: true, rawValue: true },
        })

        if (pending.length === 0) return 0

        const contractUpdates: Record<string, unknown> = {}
        const invalidFields: string[] = []
        for (const ex of pending) {
          const mapping = FIELD_MAP[ex.field]
          if (mapping && ex.rawValue !== null) {
            const coerced = mapping.coerce(ex.rawValue)
            if (isCoercedValueValid(coerced)) {
              contractUpdates[mapping.column] = coerced
            } else {
              invalidFields.push(ex.field)
            }
          }
        }

        if (invalidFields.length > 0) {
          throw Object.assign(new Error("coercion_failed"), { fields: invalidFields })
        }

        await tx.aIExtraction.updateMany({
          where: { contractId: params.id, status: "pending" },
          data: { status: "accepted" },
        })
        if (Object.keys(contractUpdates).length > 0) {
          await tx.contract.update({ where: { id: params.id }, data: contractUpdates })
        }
        return { count: pending.length, updatedFields: Object.keys(contractUpdates) }
        })
      } catch (err) {
        const e = err as Error & { fields?: string[] }
        if (e.message === "coercion_failed") {
          return Response.json(
            { error: "One or more AI-extracted values failed type coercion", fields: e.fields },
            { status: 422 },
          )
        }
        throw err
      }

      if (accepted === 0) {
        return Response.json({ accepted: 0 })
      }

      const { count, updatedFields } = accepted as { count: number; updatedFields: string[] }

      await writeActivity(
        params.id,
        ctx.userId,
        "METADATA_UPDATED",
        `Accepted all ${count} AI extraction fields`,
      )

      await regenerateAlertsIfTouched(params.id, updatedFields)

      return Response.json({ accepted: count })
    }

    // ── single-field actions (accept / reject / edit) ─────────────────────────
    const { extractionId } = body

    const extraction = await prisma.aIExtraction.findUnique({
      where: { id: extractionId },
      select: { id: true, contractId: true, field: true, rawValue: true, status: true },
    })

    if (!extraction || extraction.contractId !== params.id) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    if (body.action === "edit") {
      // Update rawValue first, then fall through to accept logic below.
      // Mark the extraction as user-edited so the audit trail reflects the
      // human override of the AI value.
      await prisma.aIExtraction.update({
        where: { id: extractionId },
        data: { rawValue: body.newValue, extractedBy: "user" },
      })
      extraction.rawValue = body.newValue
    }

    if (body.action === "accept" || body.action === "edit") {
      const mapping = FIELD_MAP[extraction.field]
      if (mapping && extraction.rawValue !== null) {
        const coerced = mapping.coerce(extraction.rawValue)
        if (!isCoercedValueValid(coerced)) {
          return Response.json(
            {
              error: "AI-extracted value failed type coercion",
              field: extraction.field,
            },
            { status: 422 },
          )
        }
        await prisma.aIExtraction.update({
          where: { id: extractionId },
          data: { status: "accepted" },
        })
        await prisma.contract.update({
          where: { id: params.id },
          data: { [mapping.column]: coerced },
        })
      } else {
        await prisma.aIExtraction.update({
          where: { id: extractionId },
          data: { status: "accepted" },
        })
      }

      await writeActivity(
        params.id,
        ctx.userId,
        "METADATA_UPDATED",
        `Accepted AI extraction for field "${extraction.field}"`,
      )

      await regenerateAlertsIfTouched(params.id, [extraction.field])
    } else {
      await prisma.aIExtraction.update({
        where: { id: extractionId },
        data: { status: "rejected" },
      })

      await writeActivity(
        params.id,
        ctx.userId,
        "METADATA_UPDATED",
        `Rejected AI extraction for field "${extraction.field}"`,
      )
    }

    const updated = await prisma.aIExtraction.findUnique({ where: { id: extractionId } })
    return Response.json(updated)
  })
}

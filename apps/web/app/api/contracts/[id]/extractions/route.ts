import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { z } from "zod"
import type { ContractType } from "@prisma/client"

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

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

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
      const pending = await prisma.aIExtraction.findMany({
        where: { contractId: params.id, status: "pending" },
        select: { id: true, field: true, rawValue: true },
      })

      if (pending.length === 0) {
        return Response.json({ accepted: 0 })
      }

      const contractUpdates: Record<string, unknown> = {}
      for (const ex of pending) {
        const mapping = FIELD_MAP[ex.field]
        if (mapping && ex.rawValue !== null) {
          contractUpdates[mapping.column] = mapping.coerce(ex.rawValue)
        }
      }

      await prisma.$transaction([
        prisma.aIExtraction.updateMany({
          where: { contractId: params.id, status: "pending" },
          data: { status: "accepted" },
        }),
        ...(Object.keys(contractUpdates).length > 0
          ? [prisma.contract.update({ where: { id: params.id }, data: contractUpdates })]
          : []),
      ])

      await writeActivity(
        params.id,
        ctx.userId,
        "METADATA_UPDATED",
        `Accepted all ${pending.length} AI extraction fields`,
      )

      return Response.json({ accepted: pending.length })
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
      // Update rawValue first, then fall through to accept logic below
      await prisma.aIExtraction.update({
        where: { id: extractionId },
        data: { rawValue: body.newValue },
      })
      extraction.rawValue = body.newValue
    }

    if (body.action === "accept" || body.action === "edit") {
      await prisma.aIExtraction.update({
        where: { id: extractionId },
        data: { status: "accepted" },
      })

      const mapping = FIELD_MAP[extraction.field]
      if (mapping && extraction.rawValue !== null) {
        await prisma.contract.update({
          where: { id: params.id },
          data: { [mapping.column]: mapping.coerce(extraction.rawValue) },
        })
      }

      await writeActivity(
        params.id,
        ctx.userId,
        "METADATA_UPDATED",
        `Accepted AI extraction for field "${extraction.field}"`,
      )
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

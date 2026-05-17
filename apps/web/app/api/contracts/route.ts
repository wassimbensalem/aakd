import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requireRole } from "@/lib/auth/roles"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { generateAlertsForContract } from "@/lib/alerts/generate"
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { SECURE_HEADERS } from "@/lib/api-headers"
import { fireAndLog } from "@/lib/utils/fire-and-log"
import { requestLogger } from "@/lib/logger"
import { Prisma } from "@prisma/client"
import { z } from "zod"

const CreateContractSchema = z.object({
  title: z.string().min(1).max(500),
  contractType: z.enum(["NDA", "MSA", "SOW", "EMPLOYMENT", "VENDOR", "CUSTOMER", "OTHER"]).optional(),
  counterpartyName: z.string().optional(),
  counterpartyContact: z.string().email().optional().or(z.literal("")),
  value: z.number().positive().optional(),
  currency: z.string().min(1).max(10).default("USD"),
  governingLaw: z.string().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  renewalDate: z.string().date().optional(),
  noticePeriodDays: z.number().int().min(0).optional(),
  autoRenewal: z.boolean().default(false),
  notes: z.string().max(10000).optional(),
  folderId: z.string().optional(),
  tagIds: z.array(z.string()).default([]),
})

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const log = requestLogger(ctx.requestId)

  return requestContext.run(ctx, async () => {
    const url = new URL(req.url)
    const status = url.searchParams.get("status") ?? undefined
    const contractType = url.searchParams.get("contractType") ?? undefined
    const ownerId = url.searchParams.get("ownerId") ?? undefined
    const folderId = url.searchParams.get("folderId") ?? undefined
    const tagId = url.searchParams.get("tagId") ?? undefined
    const search = url.searchParams.get("search") ?? undefined
    const page = (() => {
      const n = parseInt(url.searchParams.get("page") ?? "1", 10)
      return Number.isNaN(n) ? 1 : Math.max(1, n)
    })()
    const limit = (() => {
      const n = parseInt(url.searchParams.get("limit") ?? "20", 10)
      return Number.isNaN(n) ? 20 : Math.min(Math.max(1, n), 100)
    })()

    const where: Record<string, unknown> = { organizationId: ctx.organizationId }
    if (status) {
      where.status = status
    } else {
      // ARCHIVED is a soft-delete state — exclude it from the default listing.
      // Callers that explicitly want archived contracts can pass ?status=ARCHIVED.
      where.status = { not: "ARCHIVED" }
    }
    if (contractType) where.contractType = contractType
    if (ownerId) where.ownerId = ownerId
    if (folderId) where.folderId = folderId
    if (tagId) where.tags = { some: { id: tagId } }
    if (search) where.title = { contains: search, mode: "insensitive" }

    const [contracts, total] = await Promise.all([
      prisma.contract.findMany({
        where,
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
          riskScore: true,
          riskScoredAt: true,
          createdAt: true,
          updatedAt: true,
          owner: { select: { id: true, name: true, email: true, image: true } },
          tags: true,
          folder: true,
          crmLinks: { select: { provider: true } },
          _count: { select: { files: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.contract.count({ where }),
    ])

    log.info({ total, page, limit }, "[GET /contracts] listed")
    return Response.json({ contracts, total, page, limit }, { headers: SECURE_HEADERS })
  })
}

export async function POST(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const log = requestLogger(ctx.requestId)

  const roleError = requireRole(ctx.role, "member")
  if (roleError) return roleError
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  // Rate limit: 20 requests/min per org
  const rl = await rateLimit(`${ctx.organizationId}:create-contract`, 20, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter)

  return requestContext.run(ctx, async () => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response("Invalid JSON", { status: 400 })
    }

    const parsed = CreateContractSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { tagIds, folderId, startDate, endDate, renewalDate, ...rest } = parsed.data

    // Strip any HTML tags from free-text fields to prevent XSS persistence
    const stripHtml = (s: string) => s.replace(/<[^>]*>/g, "")
    if (rest.title) rest.title = stripHtml(rest.title)
    if (rest.counterpartyName) rest.counterpartyName = stripHtml(rest.counterpartyName)
    if (rest.notes) rest.notes = stripHtml(rest.notes)

    // Verify folder + tags belong to the caller's org before connecting them.
    // Prisma's `connect` does not re-check ownership, so without this an
    // attacker who guesses an id could attach a cross-tenant folder/tag.
    if (folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: folderId, organizationId: ctx.organizationId },
        select: { id: true },
      })
      if (!folder) {
        return Response.json({ error: "Folder not found in this organization" }, { status: 400 })
      }
    }
    if (tagIds.length > 0) {
      const found = await prisma.tag.findMany({
        where: { id: { in: tagIds }, organizationId: ctx.organizationId },
        select: { id: true },
      })
      if (found.length !== tagIds.length) {
        return Response.json({ error: "One or more tags not found in this organization" }, { status: 400 })
      }
    }

    // Use scalar FK instead of relation connect — middleware (lib/db/client.ts)
    // also injects organizationId as a scalar; Prisma 7 rejects having both a
    // scalar FK and a relation connect for the same field simultaneously.
    const data: Prisma.ContractUncheckedCreateInput = {
      ...rest,
      ownerId: ctx.userId,
      organizationId: ctx.organizationId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      renewalDate: renewalDate ? new Date(renewalDate) : undefined,
      folderId: folderId ?? undefined,
      tags: tagIds.length > 0 ? { connect: tagIds.map((id) => ({ id })) } : undefined,
    }

    const contract = await prisma.contract.create({
      // organizationId is injected by the Prisma middleware from AsyncLocalStorage.
      data,
      include: {
        owner: { select: { id: true, name: true, email: true, image: true } },
        tags: true,
        folder: true,
      },
    })

    await writeActivity(contract.id, ctx.userId, "CREATED")
    log.info({ contractId: contract.id }, "[POST /contracts] created")

    // Generate renewal alerts if date fields were provided (non-critical side-effect)
    if (endDate || renewalDate || parsed.data.noticePeriodDays != null) {
      fireAndLog(
        generateAlertsForContract(
          contract.id,
          endDate ? new Date(endDate) : null,
          renewalDate ? new Date(renewalDate) : null,
          parsed.data.noticePeriodDays ?? null,
        ),
        "generateAlertsForContract:contractCreated",
      )
    }

    return Response.json(contract, { status: 201 })
  })
}

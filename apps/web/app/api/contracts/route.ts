import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { generateAlertsForContract } from "@/lib/alerts/generate"
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { z } from "zod"

const CreateContractSchema = z.object({
  title: z.string().min(1).max(500),
  contractType: z.enum(["NDA", "MSA", "SOW", "EMPLOYMENT", "VENDOR", "CUSTOMER", "OTHER"]).optional(),
  counterpartyName: z.string().optional(),
  counterpartyContact: z.string().email().optional().or(z.literal("")),
  value: z.number().positive().optional(),
  currency: z.string().length(3).default("USD"),
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

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (contractType) where.contractType = contractType
    if (ownerId) where.ownerId = ownerId
    if (folderId) where.folderId = folderId
    if (tagId) where.tags = { some: { id: tagId } }
    if (search) where.title = { contains: search, mode: "insensitive" }

    const [contracts, total] = await Promise.all([
      prisma.contract.findMany({
        where,
        include: {
          owner: { select: { id: true, name: true, email: true } },
          tags: true,
          folder: true,
          _count: { select: { files: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.contract.count({ where }),
    ])

    return Response.json({ contracts, total, page, limit })
  })
}

export async function POST(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  // Rate limit: 20 requests/min per org
  const rl = rateLimit(`${ctx.organizationId}:create-contract`, 20, 60_000)
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

    const contract = await prisma.contract.create({
      // organizationId is injected by the Prisma middleware from AsyncLocalStorage
      data: {
        ...rest,
        owner: { connect: { id: ctx.userId } },
        organization: { connect: { id: ctx.organizationId } },
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        renewalDate: renewalDate ? new Date(renewalDate) : undefined,
        folderId: folderId ?? undefined,
        tags: tagIds.length > 0 ? { connect: tagIds.map((id) => ({ id })) } : undefined,
      } as any,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        tags: true,
        folder: true,
      },
    })

    await writeActivity(contract.id, ctx.userId, "CREATED")

    // Generate renewal alerts if date fields were provided
    if (endDate || renewalDate || parsed.data.noticePeriodDays != null) {
      await generateAlertsForContract(
        contract.id,
        endDate ? new Date(endDate) : null,
        renewalDate ? new Date(renewalDate) : null,
        parsed.data.noticePeriodDays ?? null
      ).catch((err) => console.error("[alerts] generateAlertsForContract failed:", err))
    }

    return Response.json(contract, { status: 201 })
  })
}

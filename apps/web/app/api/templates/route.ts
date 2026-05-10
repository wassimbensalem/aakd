import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { findUsedVariableNames } from "@/lib/editor/template"
import type { Prisma } from "@prisma/client"
import { z } from "zod"

const MAX_TEMPLATES_PER_ORG = 200
const MAX_VARIABLES = 50
const MAX_CONTENT_BYTES = 5_242_880

const VariableSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: z.string().min(1).max(100),
  type: z.enum(["text", "date", "number"]),
  required: z.boolean(),
  defaultValue: z.string().max(500).optional(),
})

const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  contractType: z
    .enum(["NDA", "MSA", "SOW", "EMPLOYMENT", "VENDOR", "CUSTOMER", "OTHER"])
    .optional(),
  content: z.array(z.unknown()).max(50_000),
  variables: z.array(VariableSchema).max(MAX_VARIABLES),
  wordCount: z.number().int().min(0).max(1_000_000),
})

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const url = new URL(req.url)
    const contractType = url.searchParams.get("contractType") ?? undefined
    const page = (() => {
      const n = parseInt(url.searchParams.get("page") ?? "1", 10)
      return Number.isNaN(n) ? 1 : Math.max(1, n)
    })()
    const limit = (() => {
      const n = parseInt(url.searchParams.get("limit") ?? "20", 10)
      return Number.isNaN(n) ? 20 : Math.min(Math.max(1, n), 100)
    })()

    const where: Record<string, unknown> = { isArchived: false }
    if (contractType) where.contractType = contractType

    const [templates, total] = await Promise.all([
      prisma.contractTemplate.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          contractType: true,
          wordCount: true,
          createdAt: true,
          updatedAt: true,
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.contractTemplate.count({ where }),
    ])

    return Response.json({ templates, total, page, limit })
  })
}

export async function POST(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  if (ctx.role !== "admin" && ctx.role !== "legal") {
    return Response.json({ error: "forbidden" }, { status: 403 })
  }

  return requestContext.run(ctx, async () => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response("Invalid JSON", { status: 400 })
    }

    const parsed = CreateTemplateSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    // Size check
    const serialized = JSON.stringify(parsed.data.content)
    if (Buffer.byteLength(serialized, "utf8") > MAX_CONTENT_BYTES) {
      return Response.json({ error: "payload_too_large" }, { status: 413 })
    }

    // Variable name uniqueness
    const seen = new Map<string, number>()
    for (const v of parsed.data.variables) {
      seen.set(v.name, (seen.get(v.name) ?? 0) + 1)
    }
    const duplicates = Array.from(seen.entries())
      .filter(([, count]) => count > 1)
      .map(([name]) => name)
    if (duplicates.length > 0) {
      return Response.json(
        { error: "duplicate_variable_names", duplicates },
        { status: 422 },
      )
    }

    // All `template_variable` chips in content must reference declared variables
    const declaredNames = new Set(parsed.data.variables.map((v) => v.name))
    const used = findUsedVariableNames(parsed.data.content)
    const undeclared = used.filter((n) => !declaredNames.has(n))
    if (undeclared.length > 0) {
      return Response.json(
        { error: "undeclared_variables", names: undeclared },
        { status: 422 },
      )
    }

    // Active template count
    const active = await prisma.contractTemplate.count({
      where: { isArchived: false },
    })
    if (active >= MAX_TEMPLATES_PER_ORG) {
      return Response.json({ error: "template_limit_reached" }, { status: 422 })
    }

    // organizationId is injected by the Prisma middleware from AsyncLocalStorage,
    // so the cast tells TS that this object satisfies ContractTemplateCreateInput
    // without us spelling the org connect manually here.
    const data: Prisma.ContractTemplateCreateInput = {
      name: parsed.data.name,
      description: parsed.data.description,
      contractType: parsed.data.contractType,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      content: parsed.data.content as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      variables: parsed.data.variables as any,
      wordCount: parsed.data.wordCount,
      createdBy: { connect: { id: ctx.userId } },
      updatedBy: { connect: { id: ctx.userId } },
      organization: { connect: { id: ctx.organizationId } },
    }
    const created = await prisma.contractTemplate.create({
      data,
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    })

    return Response.json(created, { status: 201 })
  })
}

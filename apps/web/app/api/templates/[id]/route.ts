import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { hasRole } from "@/lib/auth/roles"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { findUsedVariableNames, type TemplateVariable } from "@/lib/editor/template"
import { z } from "zod"

const MAX_VARIABLES = 50
const MAX_CONTENT_BYTES = 5_242_880

const VariableSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: z.string().min(1).max(100),
  type: z.enum(["text", "date", "number"]),
  required: z.boolean(),
  defaultValue: z.string().max(500).optional(),
})

// Accepts both TipTap doc object { type:"doc", content:[...] } and legacy Slate array
const TipTapDocSchema = z.object({
  type: z.literal("doc"),
  content: z.array(z.unknown()).max(50_000),
})
const ContentSchema = z.union([TipTapDocSchema, z.array(z.unknown()).max(50_000)])

const PatchTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  contractType: z
    .enum(["NDA", "MSA", "SOW", "EMPLOYMENT", "VENDOR", "CUSTOMER", "OTHER"])
    .nullable()
    .optional(),
  content: ContentSchema.optional(),
  variables: z.array(VariableSchema).max(MAX_VARIABLES).optional(),
  wordCount: z.number().int().min(0).max(1_000_000).optional(),
})

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const tpl = await prisma.contractTemplate.findUnique({
      where: { id: params.id },
      include: {
        createdBy: { select: { id: true, name: true } },
        updatedBy: { select: { id: true, name: true } },
      },
    })
    if (!tpl || tpl.isArchived || tpl.organizationId !== ctx.organizationId) {
      return new Response("Not Found", { status: 404 })
    }
    return Response.json(tpl)
  })
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError
  if (!hasRole(ctx.role, "legal")) {
    return Response.json({ error: "forbidden" }, { status: 403 })
  }

  return requestContext.run(ctx, async () => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response("Invalid JSON", { status: 400 })
    }

    const parsed = PatchTemplateSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const existing = await prisma.contractTemplate.findUnique({
      where: { id: params.id },
      select: { id: true, isArchived: true, organizationId: true, content: true, variables: true },
    })
    if (!existing || existing.isArchived || existing.organizationId !== ctx.organizationId) {
      return new Response("Not Found", { status: 404 })
    }

    if (parsed.data.content) {
      const serialized = JSON.stringify(parsed.data.content)
      if (Buffer.byteLength(serialized, "utf8") > MAX_CONTENT_BYTES) {
        return Response.json({ error: "payload_too_large" }, { status: 413 })
      }
    }

    if (parsed.data.variables) {
      const seen = new Map<string, number>()
      for (const v of parsed.data.variables) {
        seen.set(v.name, (seen.get(v.name) ?? 0) + 1)
      }
      const duplicates = Array.from(seen.entries())
        .filter(([, c]) => c > 1)
        .map(([n]) => n)
      if (duplicates.length > 0) {
        return Response.json(
          { error: "duplicate_variable_names", duplicates },
          { status: 422 },
        )
      }
    }

    // Validate cross-consistency: all chips reference declared variables.
    // Use whichever side of the patch is being supplied for content/variables.
    // Content may be a TipTap doc object or a legacy Slate array — normalise to array for findUsedVariableNames.
    const resolveContentArray = (c: unknown): unknown[] | null => {
      if (!c) return null
      if (Array.isArray(c)) return c
      if (typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "doc") {
        const inner = (c as Record<string, unknown>).content
        return Array.isArray(inner) ? inner : null
      }
      return null
    }

    const newContent: unknown[] | null = parsed.data.content
      ? resolveContentArray(parsed.data.content)
      : resolveContentArray(existing.content)
    const newVariables: TemplateVariable[] = parsed.data.variables
      ? (parsed.data.variables as TemplateVariable[])
      : Array.isArray(existing.variables)
      ? (existing.variables as unknown as TemplateVariable[])
      : []

    if (newContent) {
      const declared = new Set(newVariables.map((v) => v.name))
      const used = findUsedVariableNames(newContent)
      const undeclared = used.filter((n) => !declared.has(n))
      if (undeclared.length > 0) {
        return Response.json(
          { error: "undeclared_variables", names: undeclared },
          { status: 422 },
        )
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {
      updatedBy: { connect: { id: ctx.userId } },
    }
    if (parsed.data.name !== undefined) data.name = parsed.data.name
    if (parsed.data.description !== undefined) data.description = parsed.data.description
    if (parsed.data.contractType !== undefined) data.contractType = parsed.data.contractType
    if (parsed.data.content !== undefined) data.content = parsed.data.content
    if (parsed.data.variables !== undefined) data.variables = parsed.data.variables
    if (parsed.data.wordCount !== undefined) data.wordCount = parsed.data.wordCount

    const updated = await prisma.contractTemplate.update({
      where: { id: params.id },
      data,
      include: {
        createdBy: { select: { id: true, name: true } },
        updatedBy: { select: { id: true, name: true } },
      },
    })
    return Response.json(updated)
  })
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError
  if (!hasRole(ctx.role, "legal")) {
    return Response.json({ error: "forbidden" }, { status: 403 })
  }

  return requestContext.run(ctx, async () => {
    const existing = await prisma.contractTemplate.findUnique({
      where: { id: params.id },
      select: { id: true, isArchived: true, organizationId: true },
    })
    if (!existing || existing.isArchived || existing.organizationId !== ctx.organizationId) {
      return new Response("Not Found", { status: 404 })
    }

    await prisma.contractTemplate.update({
      where: { id: params.id },
      data: { isArchived: true, updatedBy: { connect: { id: ctx.userId } } },
    })
    return new Response(null, { status: 204 })
  })
}

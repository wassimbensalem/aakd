import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { substituteVariables, type TemplateVariable } from "@/lib/editor/template"
import { countWords, plateToPlaintext } from "@/lib/editor/plate-to-plaintext"
import type { Prisma } from "@prisma/client"
import { z } from "zod"

const UseTemplateSchema = z.object({
  title: z.string().min(1).max(500),
  folderId: z.string().optional(),
  tagIds: z.array(z.string()).default([]),
  values: z.record(z.string(), z.string()),
})

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError
  if (ctx.role === "viewer") {
    return Response.json({ error: "viewer role cannot use templates" }, { status: 403 })
  }

  return requestContext.run(ctx, async () => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response("Invalid JSON", { status: 400 })
    }
    const parsed = UseTemplateSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const tpl = await prisma.contractTemplate.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        isArchived: true,
        contractType: true,
        content: true,
        variables: true,
      },
    })
    if (!tpl || tpl.isArchived) {
      return new Response("Not Found", { status: 404 })
    }

    const declared: TemplateVariable[] = Array.isArray(tpl.variables)
      ? (tpl.variables as unknown as TemplateVariable[])
      : []

    // All required variables must be present (and non-empty) in values.
    const missing: string[] = []
    for (const v of declared) {
      if (v.required && !parsed.data.values[v.name]) missing.push(v.name)
    }
    if (missing.length > 0) {
      return Response.json(
        { error: "missing_required_variables", missing },
        { status: 422 },
      )
    }

    // Verify folder/tag ownership before connect.
    if (parsed.data.folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: parsed.data.folderId },
        select: { id: true },
      })
      if (!folder) {
        return Response.json({ error: "Folder not found in this organization" }, { status: 400 })
      }
    }
    if (parsed.data.tagIds.length > 0) {
      const found = await prisma.tag.findMany({
        where: { id: { in: parsed.data.tagIds } },
        select: { id: true },
      })
      if (found.length !== parsed.data.tagIds.length) {
        return Response.json({ error: "One or more tags not found in this organization" }, { status: 400 })
      }
    }

    const substituted = substituteVariables(tpl.content, parsed.data.values, declared)
    const wordCount = countWords(plateToPlaintext(substituted))

    const contractData: Prisma.ContractUncheckedCreateInput = {
      title: parsed.data.title,
      contractType: tpl.contractType ?? undefined,
      status: "DRAFT",
      ownerId: ctx.userId,
      organizationId: ctx.organizationId,
      folderId: parsed.data.folderId ?? undefined,
      tags:
        parsed.data.tagIds.length > 0
          ? { connect: parsed.data.tagIds.map((id) => ({ id })) }
          : undefined,
    }
    const contract = await prisma.contract.create({
      data: contractData,
      select: { id: true },
    })

    await prisma.contractDocument.create({
      data: {
        contractId: contract.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: substituted as any,
        wordCount,
        version: 1,
        savedById: ctx.userId,
      },
    })

    await writeActivity(contract.id, ctx.userId, "CREATED", `Created from template`)
    await writeActivity(contract.id, ctx.userId, "DOCUMENT_SAVED")

    return Response.json({ contractId: contract.id }, { status: 201 })
  })
}

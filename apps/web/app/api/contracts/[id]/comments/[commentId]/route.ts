import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { hasRole } from "@/lib/auth/roles"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { z } from "zod"

const AUTHOR_SELECT = {
  id: true,
  name: true,
  image: true,
} as const

// ─── PATCH /api/contracts/[id]/comments/[commentId] ──────────────────────────
// Resolve/unresolve a comment, or edit the body.
// - Resolving: any member can resolve/unresolve
// - Editing body: only comment author

const PatchCommentSchema = z.object({
  resolved: z.boolean().optional(),
  body: z.string().min(1).max(4000).optional(),
}).refine((d) => d.resolved !== undefined || d.body !== undefined, {
  message: "Must provide resolved or body",
})

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; commentId: string } },
) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  return requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true },
    })
    if (!contract || contract.organizationId !== ctx.organizationId) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    const comment = await prisma.contractComment.findUnique({
      where: { id: params.commentId },
      select: { id: true, contractId: true, authorId: true, resolved: true },
    })
    if (!comment || comment.contractId !== params.id) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    const parsed = PatchCommentSchema.safeParse(await req.json())
    if (!parsed.success) {
      return Response.json({ error: "Invalid request body", detail: parsed.error }, { status: 400 })
    }

    const { resolved, body } = parsed.data

    // Body edits are author-only
    if (body !== undefined && comment.authorId !== ctx.userId) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    // viewers cannot patch
    if (ctx.role === "viewer") {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    const updateData: {
      body?: string
      resolved?: boolean
      resolvedById?: string | null
      resolvedAt?: Date | null
    } = {}

    if (body !== undefined) {
      updateData.body = body
    }

    if (resolved !== undefined) {
      updateData.resolved = resolved
      updateData.resolvedById = resolved ? ctx.userId : null
      updateData.resolvedAt = resolved ? new Date() : null
    }

    const updated = await prisma.contractComment.update({
      where: { id: params.commentId },
      data: updateData,
      include: {
        author: { select: AUTHOR_SELECT },
        resolvedBy: { select: AUTHOR_SELECT },
      },
    })

    return Response.json({ comment: updated })
  })
}

// ─── DELETE /api/contracts/[id]/comments/[commentId] ─────────────────────────
// Delete a comment. Only comment author or admin/legal can delete.

export async function DELETE(
  req: Request,
  { params }: { params: { id: string; commentId: string } },
) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  return requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true },
    })
    if (!contract || contract.organizationId !== ctx.organizationId) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    const comment = await prisma.contractComment.findUnique({
      where: { id: params.commentId },
      select: { id: true, contractId: true, authorId: true },
    })
    if (!comment || comment.contractId !== params.id) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    const isAuthor = comment.authorId === ctx.userId
    const isAdminOrLegal = hasRole(ctx.role, "legal")

    if (!isAuthor && !isAdminOrLegal) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    await prisma.contractComment.delete({ where: { id: params.commentId } })

    await writeActivity(params.id, ctx.userId, "COMMENTED", "Comment deleted")

    return Response.json({ success: true })
  })
}

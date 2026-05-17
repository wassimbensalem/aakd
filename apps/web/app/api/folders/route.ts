import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { Prisma } from "@prisma/client"
import { z } from "zod"

const CreateFolderSchema = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().optional(),
})

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const folders = await prisma.folder.findMany({
      where: { parentId: null },
      include: {
        children: {
          include: {
            children: true,
            _count: { select: { contracts: true } },
          },
        },
        _count: { select: { contracts: true } },
      },
      orderBy: { name: "asc" },
    })
    return Response.json(folders)
  })
}

export async function POST(req: Request) {
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

    const parsed = CreateFolderSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const data: Prisma.FolderUncheckedCreateInput = {
      name: parsed.data.name,
      parentId: parsed.data.parentId ?? undefined,
      organizationId: ctx.organizationId,
    }

    const folder = await prisma.folder.create({ data })

    return Response.json(folder, { status: 201 })
  })
}

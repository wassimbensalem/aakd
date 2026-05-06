import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { z } from "zod"

const CreateFolderSchema = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().optional(),
})

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return new Response("Unauthorized", { status: 401 })

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
  if (!ctx) return new Response("Unauthorized", { status: 401 })

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

    if (parsed.data.parentId) {
      const parent = await prisma.folder.findUnique({
        where: { id: parsed.data.parentId },
        select: { id: true },
      })
      if (!parent) return new Response("Parent folder not found", { status: 404 })
    }

    const folder = await prisma.folder.create({
      // organizationId is injected by Prisma middleware from AsyncLocalStorage
      data: {
        name: parsed.data.name,
        parentId: parsed.data.parentId ?? null,
      } as any,
    })

    return Response.json(folder, { status: 201 })
  })
}

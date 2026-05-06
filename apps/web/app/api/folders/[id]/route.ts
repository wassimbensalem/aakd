import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { z } from "zod"

const RenameFolderSchema = z.object({
  name: z.string().min(1).max(200),
})

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response("Invalid JSON", { status: 400 })
    }

    const parsed = RenameFolderSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const existing = await prisma.folder.findUnique({
      where: { id: params.id },
      select: { id: true },
    })
    if (!existing) return new Response("Not Found", { status: 404 })

    const folder = await prisma.folder.update({
      where: { id: params.id },
      data: { name: parsed.data.name },
    })

    return Response.json(folder)
  })
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const existing = await prisma.folder.findUnique({
      where: { id: params.id },
      select: { id: true },
    })
    if (!existing) return new Response("Not Found", { status: 404 })

    // Move contracts to root
    await prisma.contract.updateMany({
      where: { folderId: params.id },
      data: { folderId: null },
    })

    await prisma.folder.delete({ where: { id: params.id } })

    return new Response(null, { status: 204 })
  })
}

import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { z } from "zod"

const CreateTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#6366f1"),
})

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const tags = await prisma.tag.findMany({
      include: { _count: { select: { contracts: true } } },
      orderBy: { name: "asc" },
    })
    return Response.json(tags)
  })
}

export async function POST(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response("Invalid JSON", { status: 400 })
    }

    const parsed = CreateTagSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const tag = await prisma.tag.upsert({
      where: {
        name_organizationId: {
          name: parsed.data.name,
          organizationId: ctx.organizationId,
        },
      },
      create: {
        name: parsed.data.name,
        color: parsed.data.color,
        organization: { connect: { id: ctx.organizationId } },
      },
      update: {},
      include: { _count: { select: { contracts: true } } },
    })

    return Response.json(tag, { status: 201 })
  })
}

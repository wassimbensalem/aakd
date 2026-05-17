import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { z } from "zod"

const CreateTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#2d7a4f"),  // Canopy primary green hsl(148 58% 30%) ≈ #2d7a4f
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
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

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
        organizationId: ctx.organizationId,
      },
      update: {},
      include: { _count: { select: { contracts: true } } },
    })

    return Response.json(tag, { status: 201 })
  })
}

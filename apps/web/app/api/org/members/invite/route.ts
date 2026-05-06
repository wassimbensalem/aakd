import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { hasRole } from "@/lib/auth/roles"
import { z } from "zod"
import { randomUUID } from "crypto"

const InviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "legal", "member", "viewer"]).default("member"),
})

export async function POST(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return new Response("Unauthorized", { status: 401 })

  if (!hasRole(ctx.role, "legal")) {
    return new Response("Forbidden", { status: 403 })
  }

  return requestContext.run(ctx, async () => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response("Invalid JSON", { status: 400 })
    }

    const parsed = InviteSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

    const invitation = await prisma.invitation.create({
      data: {
        id: randomUUID(),
        organizationId: ctx.organizationId,
        email: parsed.data.email,
        role: parsed.data.role,
        status: "pending",
        expiresAt,
        inviterId: ctx.userId,
      },
    })

    return Response.json(invitation, { status: 201 })
  })
}

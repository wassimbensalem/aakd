import { resolveAuth } from "@/lib/auth/middleware"
import { auth } from "@/lib/auth/config"
import { hasRole } from "@/lib/auth/roles"
import { z } from "zod"

const InviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "legal", "member", "viewer"]).default("member"),
})

export async function POST(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  if (!hasRole(ctx.role, "legal")) {
    return new Response("Forbidden", { status: 403 })
  }

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

  // Delegate to Better Auth: it generates the invitation row + token, sets the
  // expiresAt, and triggers our sendInvitationEmail callback configured in
  // lib/auth/config.ts.
  try {
    // Cast to any: Better Auth's default role union is "owner|admin|member".
    // ClauseFlow extends this with custom roles (legal, viewer) which the
    // plugin accepts at runtime, but the static type union does not include.
    const invitation = await auth.api.createInvitation({
      body: {
        email: parsed.data.email,
        role: parsed.data.role as any,
        organizationId: ctx.organizationId,
      },
      headers: req.headers,
    })
    return Response.json(invitation, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create invitation"
    return Response.json({ error: message }, { status: 400 })
  }
}

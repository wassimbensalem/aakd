import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { auth } from "@/lib/auth/config"
import { hasRole, type Role } from "@/lib/auth/roles"
import { z } from "zod"

const InviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "legal", "member", "viewer"]).default("member"),
})

const ROLE_RANK: Record<Role, number> = {
  owner: 5,
  admin: 4,
  legal: 3,
  member: 2,
  viewer: 1,
}

export async function POST(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const writeCheck = requireWriteScope(ctx)
  if (writeCheck) return writeCheck

  if (!hasRole(ctx.role, "admin")) {
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

  // The invited role cannot exceed the inviter's role. Without this an
  // admin could mint an owner, escalating beyond their own privileges.
  const inviterRank = ROLE_RANK[ctx.role as Role] ?? 0
  const invitedRank = ROLE_RANK[parsed.data.role as Role] ?? 0
  if (invitedRank > inviterRank) {
    return Response.json(
      { error: "cannot_invite_higher_role" },
      { status: 403 },
    )
  }

  // Delegate to Better Auth: it generates the invitation row + token, sets the
  // expiresAt, and triggers our sendInvitationEmail callback configured in
  // lib/auth/config.ts.
  try {
    // Cast through never: Better Auth's default role union is "owner|admin|member".
    // ClauseFlow extends this with custom roles (legal, viewer) which the
    // plugin accepts at runtime, but the static type union does not include.
    const invitation = await auth.api.createInvitation({
      body: {
        email: parsed.data.email,
        role: parsed.data.role as never,
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

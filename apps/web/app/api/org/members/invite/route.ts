import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { hasRole, type Role } from "@/lib/auth/roles"
import { prisma } from "@/lib/db/client"
import { sendInvitationEmail } from "@/lib/email/invitation"
import { randomBytes } from "crypto"
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

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  if (!hasRole(ctx.role, "admin")) return new Response("Forbidden", { status: 403 })

  const invitations = await prisma.invitation.findMany({
    where: {
      organizationId: ctx.organizationId,
      status: "pending",
      expiresAt: { gt: new Date() },
    },
    orderBy: { expiresAt: "asc" },
  })

  return Response.json(invitations)
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

  // The invited role cannot exceed the inviter's role.
  const inviterRank = ROLE_RANK[ctx.role as Role] ?? 0
  const invitedRank = ROLE_RANK[parsed.data.role as Role] ?? 0
  if (invitedRank > inviterRank) {
    return Response.json({ error: "cannot_invite_higher_role" }, { status: 403 })
  }

  // Check if the email is already an active member
  const existingMember = await prisma.member.findFirst({
    where: {
      organizationId: ctx.organizationId,
      user: { email: parsed.data.email },
    },
  })
  if (existingMember) {
    return Response.json({ error: "already_member" }, { status: 409 })
  }

  // Check if there's already a pending invitation
  const existing = await prisma.invitation.findFirst({
    where: {
      organizationId: ctx.organizationId,
      email: parsed.data.email,
      status: "pending",
      expiresAt: { gt: new Date() },
    },
  })
  if (existing) {
    return Response.json({ error: "already_invited" }, { status: 409 })
  }

  // Create invitation directly — bypasses Better Auth's role validation
  // which only accepts its built-in "owner|admin|member" enum.
  const id = randomBytes(16).toString("hex")
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

  const invitation = await prisma.invitation.create({
    data: {
      id,
      organizationId: ctx.organizationId,
      email: parsed.data.email,
      role: parsed.data.role,
      status: "pending",
      expiresAt,
      inviterId: ctx.userId,
    },
  })

  // Look up org + inviter name for the email
  const [org, inviter] = await Promise.all([
    prisma.organization.findUnique({ where: { id: ctx.organizationId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true, email: true } }),
  ])

  const baseUrl = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  const acceptUrl = `${baseUrl}/accept-invitation?id=${id}`

  // Fire-and-forget — email failure must not abort the invitation
  sendInvitationEmail({
    to: parsed.data.email,
    organizationName: org?.name ?? "your organization",
    inviterName: inviter?.name ?? inviter?.email ?? "A teammate",
    acceptUrl,
  }).catch((err) => {
    console.error("[invitation] sendInvitationEmail failed:", err)
  })

  return Response.json({ id: invitation.id, email: invitation.email, role: invitation.role }, { status: 201 })
}

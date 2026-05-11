import { resolveAuth } from "@/lib/auth/middleware"
import { hasRole } from "@/lib/auth/roles"
import { prisma } from "@/lib/db/client"
import { sendInvitationEmail } from "@/lib/email/invitation"

// ─── POST /api/org/invitations/[id]/resend ────────────────────────────────────
// Refreshes the expiry to 30 days from now and re-sends the invitation email.

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  if (!hasRole(ctx.role, "admin")) return new Response("Forbidden", { status: 403 })

  const invitation = await prisma.invitation.findUnique({
    where: { id: params.id },
  })

  if (!invitation || invitation.organizationId !== ctx.organizationId) {
    return Response.json({ error: "Not Found" }, { status: 404 })
  }

  if (invitation.status !== "pending") {
    return Response.json({ error: "Invitation already accepted or cancelled" }, { status: 409 })
  }

  // Refresh expiry
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  await prisma.invitation.update({
    where: { id: params.id },
    data: { expiresAt },
  })

  // Re-send email
  const [org, inviter] = await Promise.all([
    prisma.organization.findUnique({ where: { id: ctx.organizationId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true, email: true } }),
  ])

  const baseUrl = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  const acceptUrl = `${baseUrl}/accept-invitation?id=${params.id}`

  sendInvitationEmail({
    to: invitation.email,
    organizationName: org?.name ?? "your organization",
    inviterName: inviter?.name ?? inviter?.email ?? "A teammate",
    acceptUrl,
  }).catch((err) => {
    console.error("[invitation] resend email failed:", err)
  })

  return Response.json({ resent: true, expiresAt })
}

// ─── DELETE /api/org/invitations/[id] ────────────────────────────────────────
// Cancels (hard-deletes) a pending invitation.

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  if (!hasRole(ctx.role, "admin")) return new Response("Forbidden", { status: 403 })

  const invitation = await prisma.invitation.findUnique({
    where: { id: params.id },
  })

  if (!invitation || invitation.organizationId !== ctx.organizationId) {
    return Response.json({ error: "Not Found" }, { status: 404 })
  }

  await prisma.invitation.delete({ where: { id: params.id } })

  return new Response(null, { status: 204 })
}

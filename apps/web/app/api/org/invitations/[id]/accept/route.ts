import { resolveAuth } from "@/lib/auth/middleware"
import { prisma } from "@/lib/db/client"

// ─── POST /api/org/invitations/[id]/accept ────────────────────────────────────
// Accepts a pending invitation for the currently logged-in user.
// Validates email match, creates the Member row, marks invitation accepted.

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const invitation = await prisma.invitation.findUnique({
    where: { id: params.id },
  })

  if (!invitation) {
    return Response.json({ error: "Invitation not found" }, { status: 404 })
  }

  if (invitation.status !== "pending") {
    return Response.json({ error: "already_accepted" }, { status: 409 })
  }

  if (invitation.expiresAt < new Date()) {
    return Response.json({ error: "expired" }, { status: 410 })
  }

  // Verify the logged-in user's email matches the invitation
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { email: true },
  })

  if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return Response.json(
      { error: "email_mismatch", message: "This invitation was sent to a different email address." },
      { status: 403 },
    )
  }

  // Check if already a member
  const existing = await prisma.member.findUnique({
    where: {
      userId_organizationId: {
        userId: ctx.userId,
        organizationId: invitation.organizationId,
      },
    },
  })

  if (existing) {
    // Already a member — mark invitation accepted and return the org so the
    // frontend can still call setActive and redirect to dashboard.
    await prisma.invitation.update({
      where: { id: params.id },
      data: { status: "accepted" },
    })
    return Response.json({ organizationId: invitation.organizationId, alreadyMember: true })
  }

  // Create the Member record and mark invitation accepted in a transaction
  const [member] = await prisma.$transaction([
    prisma.member.create({
      data: {
        id: `${ctx.userId}-${invitation.organizationId}`.slice(0, 36),
        userId: ctx.userId,
        organizationId: invitation.organizationId,
        role: invitation.role ?? "member",
        createdAt: new Date(),
      },
    }),
    prisma.invitation.update({
      where: { id: params.id },
      data: { status: "accepted" },
    }),
  ])

  return Response.json({
    organizationId: member.organizationId,
    role: member.role,
  })
}

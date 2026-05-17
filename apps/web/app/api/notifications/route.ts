import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"

// GET /api/notifications
// Returns the last 30 notifications for the authenticated user.
// The Notification model is NOT org-scoped via middleware, so we query
// explicitly by userId (and organizationId for safety).
export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    // `org.invited` notifications are stored under the *inviting* org's ID —
    // an org the invitee hasn't joined yet and therefore isn't their active org.
    // We widen the query with an OR so those cross-org invitations still surface.
    const notifWhere = {
      userId: ctx.userId,
      OR: [
        { organizationId: ctx.organizationId },
        { eventName: "org.invited" },
      ],
    }

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: notifWhere,
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          contractId: true,
          eventName: true,
          title: true,
          body: true,
          read: true,
          readAt: true,
          createdAt: true,
        },
      }),
      prisma.notification.count({
        where: { ...notifWhere, read: false },
      }),
    ])

    return Response.json({ notifications, unreadCount })
  })
}

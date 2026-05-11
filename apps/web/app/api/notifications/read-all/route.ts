import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"

// POST /api/notifications/read-all
// Marks all unread notifications for the authenticated user as read.
export async function POST(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    await prisma.notification.updateMany({
      where: { userId: ctx.userId, organizationId: ctx.organizationId, read: false },
      data: { read: true, readAt: new Date() },
    })

    return Response.json({ ok: true })
  })
}

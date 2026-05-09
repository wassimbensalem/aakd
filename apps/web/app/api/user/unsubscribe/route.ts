import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/client"
import { verifyUnsubscribeToken } from "@/lib/notifications/unsubscribe-token"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams.get("token")
  if (!token) {
    return Response.json({ error: "invalid_token" }, { status: 400 })
  }

  const decoded = verifyUnsubscribeToken(token)
  if (!decoded) {
    return Response.json({ error: "invalid_token" }, { status: 400 })
  }

  const { userId, orgId, eventName } = decoded

  const member = await prisma.member.findUnique({
    where: { userId_organizationId: { userId, organizationId: orgId } },
    select: { userId: true },
  })
  if (!member) {
    return Response.json({ error: "invalid_token" }, { status: 400 })
  }

  await prisma.userNotificationPreference.upsert({
    where: {
      userId_organizationId_eventName: {
        userId,
        organizationId: orgId,
        eventName,
      },
    },
    update: { emailEnabled: false },
    create: { userId, organizationId: orgId, eventName, emailEnabled: false },
  })

  const redirectUrl = new URL(
    `/settings/profile/notifications?unsubscribed=1&event=${encodeURIComponent(eventName)}`,
    url.origin,
  )
  return NextResponse.redirect(redirectUrl)
}

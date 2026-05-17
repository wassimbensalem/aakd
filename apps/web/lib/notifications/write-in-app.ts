/**
 * write-in-app — synchronous in-app notification writes.
 *
 * These helpers write Notification rows DIRECTLY from API routes rather than
 * routing through BullMQ → worker. This guarantees delivery regardless of
 * whether the worker process is running.
 *
 * The fanout worker (worker.ts) continues to handle external channels
 * (Slack, Teams, email, webhooks). For cron-only events (expiring_soon,
 * expired, obligation.due_soon, obligation.overdue) the worker still calls
 * createInAppNotifications directly, since those have no API route trigger.
 *
 * The `Notification` model is intentionally NOT in ORG_SCOPED_MODELS, so
 * these helpers are safe to call with or without an active request context.
 */
import { prisma } from "@/lib/db/client"
import { logger } from "@/lib/logger"

/**
 * Write a single in-app notification row. Errors are caught and logged —
 * notification failure must never abort the calling request.
 */
export async function writeInApp(
  userId: string,
  organizationId: string,
  contractId: string | null,
  eventName: string,
  title: string,
  body: string,
): Promise<void> {
  try {
    await prisma.notification.create({
      data: { userId, organizationId, contractId, eventName, title, body },
    })
  } catch (err) {
    logger.error({ err, eventName, userId }, "[in-app] notification write failed")
  }
}

/**
 * Write the same in-app notification to every admin/legal/owner member of an
 * org. Optionally skip one userId (e.g. the actor who triggered the event).
 */
export async function writeInAppToOrgMembers(
  organizationId: string,
  contractId: string | null,
  eventName: string,
  title: string,
  body: string,
  excludeUserId?: string,
): Promise<void> {
  try {
    const members = await prisma.member.findMany({
      where: { organizationId, role: { in: ["legal", "admin", "owner"] } },
      select: { userId: true },
    })
    await Promise.all(
      members
        .filter((m) => m.userId !== excludeUserId)
        .map((m) => writeInApp(m.userId, organizationId, contractId, eventName, title, body)),
    )
  } catch (err) {
    logger.error({ err, eventName, organizationId }, "[in-app] org-wide notification write failed")
  }
}

/**
 * Entry point for firing notification events from API routes and workers.
 *
 * Callers do not contact any channel inline. enqueueNotification puts a
 * single `notification.fanout` job on the queue and returns immediately.
 * The fanout worker (worker.ts) resolves recipients, builds payloads,
 * computes HMAC signatures, and enqueues every downstream delivery.
 *
 * All shared event-name types and label/default constants live in events.ts.
 * This file re-exports them so callers don't need to update their import paths.
 */
import { notificationFanoutQueue } from "@/lib/jobs/queues"

export {
  type NotificationEventName,
  NOTIFICATION_EVENTS as NOTIFICATION_EVENT_NAMES,
  HUMAN_EVENT_LABELS,
  DEFAULT_EMAIL_ENABLED,
  WEBHOOK_API_VERSION,
} from "@/lib/notifications/events"

import type { NotificationEventName } from "@/lib/notifications/events"

/**
 * Enqueue a fan-out job for a single contract lifecycle event. Returns
 * immediately — the worker handles channel resolution, payload construction,
 * signing, and delivery. Failures to enqueue are logged but never thrown so
 * the caller's primary action is never blocked.
 */
export async function enqueueNotification(
  eventName: NotificationEventName,
  contractId: string,
  actorId: string | null,
  metadata: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  try {
    await notificationFanoutQueue.add("fanout", {
      eventName,
      contractId,
      actorId,
      metadata,
    })
  } catch (err) {
    console.error(
      `[notifications] failed to enqueue fanout for ${eventName} contract=${contractId}:`,
      err,
    )
  }
}

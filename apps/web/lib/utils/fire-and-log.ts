import { logger } from "@/lib/logger"

/**
 * fireAndLog — run a promise as a non-blocking side-effect.
 *
 * Use this for side-effects that must NOT fail the current request:
 *   - Notification / webhook enqueues
 *   - Email sends
 *   - BullMQ job enqueues for background processing
 *   - Alert generation after contract mutations
 *
 * Do NOT use this for:
 *   - Activity / audit-trail writes  → await those; they must be consistent
 *   - Core DB mutations that affect visible state
 *
 * @param promise  The promise to run in the background.
 * @param label    A short identifier included in the error log (e.g. "enqueueNotification:contractCreated").
 */

export function fireAndLog(promise: Promise<unknown>, label: string): void {
  promise.catch((err: unknown) => {
    logger.error({ err, label }, "[background] fire-and-forget task failed")
  })
}

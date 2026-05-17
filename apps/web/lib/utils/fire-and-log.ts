import { requestLogger, logger } from "@/lib/logger"

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
 * @param promise    The promise to run in the background.
 * @param label      A short identifier included in the error log (e.g. "enqueueNotification:contractCreated").
 * @param requestId  Optional request ID for log correlation. Pass ctx.requestId to tie the error back to the originating request.
 */

export function fireAndLog(promise: Promise<unknown>, label: string, requestId?: string): void {
  const log = requestId ? requestLogger(requestId) : logger
  promise.catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err: message }, `[background] ${label} failed`)
  })
}

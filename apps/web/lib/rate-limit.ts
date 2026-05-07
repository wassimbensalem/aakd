/**
 * In-memory sliding-window rate limiter.
 * No external dependencies — uses a plain Map.
 *
 * Key granularity is up to the caller:
 *   - Per-org:  key = `${organizationId}:${routeId}`
 *   - Per-IP:   key = `${ip}:${routeId}`
 */

interface WindowEntry {
  /** Timestamps (ms) of each request inside the current window */
  timestamps: number[]
}

const store = new Map<string, WindowEntry>()

/**
 * Check and record a request against the rate limit.
 *
 * @param key       Unique key for the bucket (e.g. `org-id:create-contract`)
 * @param limit     Maximum number of requests allowed per window
 * @param windowMs  Window size in milliseconds (e.g. 60_000 for 1 minute)
 * @returns         `{ allowed: true }` or `{ allowed: false, retryAfter: <seconds> }`
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: true; retryAfter: 0 } | { allowed: false; retryAfter: number } {
  const now = Date.now()
  const windowStart = now - windowMs

  let entry = store.get(key)
  if (!entry) {
    entry = { timestamps: [] }
    store.set(key, entry)
  }

  // Drop timestamps outside the current window
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart)

  if (entry.timestamps.length >= limit) {
    // Oldest timestamp in the window tells us when a slot opens up
    const oldestInWindow = entry.timestamps[0]!
    const retryAfterMs = oldestInWindow + windowMs - now
    const retryAfterSecs = Math.ceil(retryAfterMs / 1000)
    return { allowed: false, retryAfter: Math.max(1, retryAfterSecs) }
  }

  entry.timestamps.push(now)
  return { allowed: true, retryAfter: 0 }
}

/**
 * Build a 429 response with the standard `Retry-After` header.
 */
export function rateLimitResponse(retryAfter: number): Response {
  return Response.json(
    { error: "Rate limit exceeded", retryAfter },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": "exceeded",
      },
    },
  )
}

/** Exposed for testing — clears all buckets */
export function _clearStore(): void {
  store.clear()
}

/**
 * Redis-backed sliding-window rate limiter.
 *
 * Uses the same Redis instance as BullMQ. State is shared across all pods, so
 * multi-replica deployments enforce a single global limit per key.
 *
 * Falls back to an in-memory sliding window if Redis is unavailable — this
 * keeps the dev experience working without Redis but is best-effort only.
 *
 * Key granularity is up to the caller:
 *   - Per-org:  key = `${organizationId}:${routeId}`
 *   - Per-IP:   key = `${ip}:${routeId}`
 */

import IORedis, { type Redis } from "ioredis"

let _client: Redis | null = null
let _clientAttempted = false

function getClient(): Redis | null {
  if (_clientAttempted) return _client
  _clientAttempted = true

  const url = process.env.REDIS_URL
  if (!url) return null

  try {
    _client = new IORedis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    })
    _client.on("error", () => {
      // Swallow — we fall through to in-memory below on each call
    })
  } catch {
    _client = null
  }
  return _client
}

// ─── In-memory fallback ────────────────────────────────────────────────────────
// Used only when REDIS_URL is unset or the Redis call throws. Single-pod only.

interface WindowEntry {
  timestamps: number[]
}
const memStore = new Map<string, WindowEntry>()

function inMemoryCheck(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: true; retryAfter: 0 } | { allowed: false; retryAfter: number } {
  const now = Date.now()
  const windowStart = now - windowMs

  let entry = memStore.get(key)
  if (!entry) {
    entry = { timestamps: [] }
    memStore.set(key, entry)
  }

  entry.timestamps = entry.timestamps.filter((t) => t > windowStart)

  if (entry.timestamps.length >= limit) {
    const oldestInWindow = entry.timestamps[0]!
    const retryAfterMs = oldestInWindow + windowMs - now
    const retryAfterSecs = Math.ceil(retryAfterMs / 1000)
    return { allowed: false, retryAfter: Math.max(1, retryAfterSecs) }
  }

  entry.timestamps.push(now)
  return { allowed: true, retryAfter: 0 }
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Check and record a request against the rate limit.
 *
 * @param key       Unique key for the bucket (e.g. `org-id:create-contract`)
 * @param limit     Maximum number of requests allowed per window
 * @param windowMs  Window size in milliseconds (e.g. 60_000 for 1 minute)
 * @returns         `{ allowed: true }` or `{ allowed: false, retryAfter: <seconds> }`
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<
  { allowed: true; retryAfter: 0 } | { allowed: false; retryAfter: number }
> {
  const client = getClient()
  if (!client) return inMemoryCheck(key, limit, windowMs)

  const now = Date.now()
  const windowStart = now - windowMs
  const redisKey = `ratelimit:${key}:${windowMs}`
  const member = `${now}-${Math.random()}`
  const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000))

  try {
    // Atomic sliding-window:
    //   1) drop entries older than the current window
    //   2) record this request
    //   3) read the count after insertion
    //   4) refresh TTL so the key auto-expires when idle
    //   5) read the oldest remaining timestamp so we can compute retryAfter
    const pipeline = client.multi()
    pipeline.zremrangebyscore(redisKey, 0, windowStart)
    pipeline.zadd(redisKey, now, member)
    pipeline.zcard(redisKey)
    pipeline.expire(redisKey, ttlSeconds)
    pipeline.zrange(redisKey, 0, 0, "WITHSCORES")
    const results = await pipeline.exec()

    if (!results) return inMemoryCheck(key, limit, windowMs)

    const countResult = results[2]
    const oldestResult = results[4]
    const count =
      Array.isArray(countResult) && typeof countResult[1] === "number"
        ? (countResult[1] as number)
        : 0

    if (count <= limit) {
      return { allowed: true, retryAfter: 0 }
    }

    // Over the limit — pull our own entry back out so a blocked attempt
    // doesn't keep extending the window for legitimate callers.
    await client.zrem(redisKey, member).catch(() => {})

    let oldestScore = now
    if (Array.isArray(oldestResult) && Array.isArray(oldestResult[1])) {
      const arr = oldestResult[1] as string[]
      // ZRANGE WITHSCORES returns [member, score, ...]
      if (arr.length >= 2) {
        const parsed = Number(arr[1])
        if (Number.isFinite(parsed)) oldestScore = parsed
      }
    }

    const retryAfterMs = oldestScore + windowMs - now
    const retryAfterSecs = Math.ceil(retryAfterMs / 1000)
    return { allowed: false, retryAfter: Math.max(1, retryAfterSecs) }
  } catch {
    return inMemoryCheck(key, limit, windowMs)
  }
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

/** Exposed for testing — clears all in-memory buckets */
export function _clearStore(): void {
  memStore.clear()
}

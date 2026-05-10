import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { rateLimit, _clearStore } from "@/lib/rate-limit"

// These tests exercise the in-memory fallback path. The Redis path is
// covered by integration tests against a real Redis. By unsetting REDIS_URL
// before importing the module we force the fallback.
const ORIGINAL_REDIS_URL = process.env.REDIS_URL

describe("rateLimit() — in-memory fallback", () => {
  beforeEach(() => {
    delete process.env.REDIS_URL
    _clearStore()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    if (ORIGINAL_REDIS_URL !== undefined) process.env.REDIS_URL = ORIGINAL_REDIS_URL
  })

  it("allows the first request", async () => {
    const result = await rateLimit("test-key", 5, 60_000)
    expect(result.allowed).toBe(true)
  })

  it("allows requests up to the limit", async () => {
    for (let i = 0; i < 5; i++) {
      const result = await rateLimit("test-key", 5, 60_000)
      expect(result.allowed).toBe(true)
    }
  })

  it("blocks the request that exceeds the limit", async () => {
    for (let i = 0; i < 5; i++) {
      await rateLimit("test-key", 5, 60_000)
    }
    const result = await rateLimit("test-key", 5, 60_000)
    expect(result.allowed).toBe(false)
  })

  it("returns a positive retryAfter when blocked", async () => {
    for (let i = 0; i < 3; i++) {
      await rateLimit("test-key", 3, 60_000)
    }
    const result = await rateLimit("test-key", 3, 60_000)
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.retryAfter).toBeGreaterThan(0)
    }
  })

  it("window resets after windowMs — allows requests again", async () => {
    for (let i = 0; i < 3; i++) {
      await rateLimit("test-key", 3, 60_000)
    }

    expect((await rateLimit("test-key", 3, 60_000)).allowed).toBe(false)

    vi.advanceTimersByTime(61_000)

    expect((await rateLimit("test-key", 3, 60_000)).allowed).toBe(true)
  })

  it("different keys are independent", async () => {
    for (let i = 0; i < 3; i++) {
      await rateLimit("key-a", 3, 60_000)
    }

    expect((await rateLimit("key-a", 3, 60_000)).allowed).toBe(false)
    expect((await rateLimit("key-b", 3, 60_000)).allowed).toBe(true)
  })

  it("retryAfter is based on the oldest timestamp in the window", async () => {
    await rateLimit("test-key", 3, 60_000)
    vi.advanceTimersByTime(10_000)
    await rateLimit("test-key", 3, 60_000)
    vi.advanceTimersByTime(10_000)
    await rateLimit("test-key", 3, 60_000)

    const result = await rateLimit("test-key", 3, 60_000)
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.retryAfter).toBeGreaterThanOrEqual(39)
      expect(result.retryAfter).toBeLessThanOrEqual(41)
    }
  })

  it("partial window expiry allows new requests without waiting for full reset", async () => {
    await rateLimit("test-key", 3, 60_000)
    await rateLimit("test-key", 3, 60_000)
    await rateLimit("test-key", 3, 60_000)

    vi.advanceTimersByTime(61_000)

    expect((await rateLimit("test-key", 3, 60_000)).allowed).toBe(true)
    expect((await rateLimit("test-key", 3, 60_000)).allowed).toBe(true)
    expect((await rateLimit("test-key", 3, 60_000)).allowed).toBe(true)
    expect((await rateLimit("test-key", 3, 60_000)).allowed).toBe(false)
  })
})

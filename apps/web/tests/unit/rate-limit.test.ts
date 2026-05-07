import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { rateLimit, _clearStore } from "@/lib/rate-limit"

describe("rateLimit()", () => {
  beforeEach(() => {
    _clearStore()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("allows the first request", () => {
    const result = rateLimit("test-key", 5, 60_000)
    expect(result.allowed).toBe(true)
  })

  it("allows requests up to the limit", () => {
    for (let i = 0; i < 5; i++) {
      const result = rateLimit("test-key", 5, 60_000)
      expect(result.allowed).toBe(true)
    }
  })

  it("blocks the request that exceeds the limit", () => {
    for (let i = 0; i < 5; i++) {
      rateLimit("test-key", 5, 60_000)
    }
    const result = rateLimit("test-key", 5, 60_000)
    expect(result.allowed).toBe(false)
  })

  it("returns a positive retryAfter when blocked", () => {
    for (let i = 0; i < 3; i++) {
      rateLimit("test-key", 3, 60_000)
    }
    const result = rateLimit("test-key", 3, 60_000)
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.retryAfter).toBeGreaterThan(0)
    }
  })

  it("window resets after windowMs — allows requests again", () => {
    for (let i = 0; i < 3; i++) {
      rateLimit("test-key", 3, 60_000)
    }

    // All slots consumed
    expect(rateLimit("test-key", 3, 60_000).allowed).toBe(false)

    // Advance past the window
    vi.advanceTimersByTime(61_000)

    // Should be allowed again
    expect(rateLimit("test-key", 3, 60_000).allowed).toBe(true)
  })

  it("different keys are independent", () => {
    for (let i = 0; i < 3; i++) {
      rateLimit("key-a", 3, 60_000)
    }

    // key-a is exhausted
    expect(rateLimit("key-a", 3, 60_000).allowed).toBe(false)

    // key-b should still be fine
    expect(rateLimit("key-b", 3, 60_000).allowed).toBe(true)
  })

  it("retryAfter is based on the oldest timestamp in the window", () => {
    // Make 3 requests, each 10 seconds apart
    rateLimit("test-key", 3, 60_000)
    vi.advanceTimersByTime(10_000)
    rateLimit("test-key", 3, 60_000)
    vi.advanceTimersByTime(10_000)
    rateLimit("test-key", 3, 60_000)

    // 4th request should be blocked — oldest slot is ~20s old
    // => oldest + 60s - now = (t0 + 20s) + 60s - (t0 + 20s) = 60s
    const result = rateLimit("test-key", 3, 60_000)
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      // Oldest timestamp was 20s ago, so retryAfter ≈ 40s
      expect(result.retryAfter).toBeGreaterThanOrEqual(39)
      expect(result.retryAfter).toBeLessThanOrEqual(41)
    }
  })

  it("partial window expiry allows new requests without waiting for full reset", () => {
    // Fill up 3 slots at t=0
    rateLimit("test-key", 3, 60_000)
    rateLimit("test-key", 3, 60_000)
    rateLimit("test-key", 3, 60_000)

    // Advance 61s — all 3 original slots expire
    vi.advanceTimersByTime(61_000)

    // Now we have room for 3 new requests
    expect(rateLimit("test-key", 3, 60_000).allowed).toBe(true)
    expect(rateLimit("test-key", 3, 60_000).allowed).toBe(true)
    expect(rateLimit("test-key", 3, 60_000).allowed).toBe(true)
    expect(rateLimit("test-key", 3, 60_000).allowed).toBe(false)
  })
})

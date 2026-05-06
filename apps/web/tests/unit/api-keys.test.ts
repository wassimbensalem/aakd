import { describe, it, expect } from "vitest"
import { generateApiKey } from "@/lib/auth/api-keys"

describe("generateApiKey", () => {
  it("generates a key with cf_live_ prefix", async () => {
    const key = await generateApiKey()
    expect(key.raw).toMatch(/^cf_live_[a-f0-9]{64}$/)
  })

  it("prefix is first 20 chars of raw key", async () => {
    const key = await generateApiKey()
    expect(key.prefix).toBe(key.raw.slice(0, 20))
  })

  it("keyHash is different from raw", async () => {
    const key = await generateApiKey()
    expect(key.keyHash).not.toBe(key.raw)
    expect(key.keyHash).toMatch(/^\$2[ab]\$/)  // bcrypt format
  })

  it("lookupHash is SHA-256 hex", async () => {
    const key = await generateApiKey()
    expect(key.lookupHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("two generated keys are always unique", async () => {
    const [a, b] = await Promise.all([generateApiKey(), generateApiKey()])
    expect(a.raw).not.toBe(b.raw)
    expect(a.lookupHash).not.toBe(b.lookupHash)
  })
})

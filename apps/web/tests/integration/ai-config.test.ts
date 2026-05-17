/**
 * Integration tests for /api/org/ai-config routes.
 *
 * Covers: GET/POST/DELETE, role enforcement, org isolation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { prisma } from "@/lib/db/client"

// ── Base ctx for an admin in org-1 ─────────────────────────────────────────

const adminCtx = {
  userId: "user-admin",
  organizationId: "org-1",
  role: "admin",
  source: "session" as const,
  requestId: "test-request-id",
}

const viewerCtx = {
  userId: "user-viewer",
  organizationId: "org-1",
  role: "viewer",
  source: "session" as const,
  requestId: "test-request-id",
}

let mockCtx: typeof adminCtx | null = adminCtx

vi.mock("@/lib/auth/middleware", () => ({
  resolveAuth: vi.fn(() => Promise.resolve(mockCtx)),
}))

vi.mock("@/lib/notifications/crypto", () => ({
  encrypt: vi.fn((s: string) => `enc:${s}`),
  decrypt: vi.fn((s: string) => s.replace("enc:", "")),
}))

// We reference vi.mocked(encrypt) inside tests via the already-mocked module.
// Import it here so TypeScript resolves the type.
import { encrypt } from "@/lib/notifications/crypto"

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/org/ai-config", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCtx = adminCtx
  })

  it("returns hasKey:false when no config exists", async () => {
    vi.mocked(prisma.orgAiConfig.findUnique).mockResolvedValue(null)
    const { GET } = await import("@/app/api/org/ai-config/route")

    const res = await GET(new Request("http://localhost/api/org/ai-config"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.hasKey).toBe(false)
    expect(body.provider).toBeNull()
  })

  it("returns provider and hasKey:true when config exists (never the key)", async () => {
    vi.mocked(prisma.orgAiConfig.findUnique).mockResolvedValue({
      provider: "anthropic",
      model: "claude-3-5-sonnet-latest",
    } as any)

    const { GET } = await import("@/app/api/org/ai-config/route")
    const res = await GET(new Request("http://localhost/api/org/ai-config"))
    const body = await res.json()

    expect(body.hasKey).toBe(true)
    expect(body.provider).toBe("anthropic")
    expect(body).not.toHaveProperty("encryptedKey")
    expect(body).not.toHaveProperty("apiKey")
  })

  it("returns 401 when unauthenticated", async () => {
    mockCtx = null
    const { GET } = await import("@/app/api/org/ai-config/route")
    const res = await GET(new Request("http://localhost/api/org/ai-config"))
    expect(res.status).toBe(401)
  })
})

describe("POST /api/org/ai-config", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCtx = adminCtx
  })

  it("upserts config and never stores raw key", async () => {
    const saved = { provider: "anthropic", model: null }
    vi.mocked(prisma.orgAiConfig.upsert).mockResolvedValue(saved as any)

    const { POST } = await import("@/app/api/org/ai-config/route")
    const res = await POST(
      new Request("http://localhost/api/org/ai-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "anthropic", apiKey: "sk-ant-real-key" }),
      }),
    )

    expect(res.status).toBe(200)

    // Verify encrypt was called and raw key was not persisted
    expect(encrypt).toHaveBeenCalledWith("sk-ant-real-key")
    const upsertCall = vi.mocked(prisma.orgAiConfig.upsert).mock.calls[0][0]
    expect(upsertCall.create.encryptedKey).toBe("enc:sk-ant-real-key")
    expect(upsertCall.create).not.toHaveProperty("apiKey")
  })

  it("returns 403 when role is viewer", async () => {
    mockCtx = viewerCtx
    const { POST } = await import("@/app/api/org/ai-config/route")
    const res = await POST(
      new Request("http://localhost/api/org/ai-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "anthropic", apiKey: "sk-key" }),
      }),
    )
    expect(res.status).toBe(403)
  })

  it("returns 400 when provider is invalid", async () => {
    const { POST } = await import("@/app/api/org/ai-config/route")
    const res = await POST(
      new Request("http://localhost/api/org/ai-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "cohere", apiKey: "sk-key" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("scopes upsert to ctx.organizationId only", async () => {
    vi.mocked(prisma.orgAiConfig.upsert).mockResolvedValue({ provider: "openai", model: null } as any)
    const { POST } = await import("@/app/api/org/ai-config/route")

    await POST(
      new Request("http://localhost/api/org/ai-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "openai", apiKey: "sk-key" }),
      }),
    )

    const upsertCall = vi.mocked(prisma.orgAiConfig.upsert).mock.calls[0][0]
    expect(upsertCall.where.organizationId).toBe("org-1")
    expect(upsertCall.create.organizationId).toBe("org-1")
  })
})

describe("DELETE /api/org/ai-config", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCtx = adminCtx
  })

  it("deletes only the calling org's config", async () => {
    vi.mocked(prisma.orgAiConfig.deleteMany).mockResolvedValue({ count: 1 })
    const { DELETE } = await import("@/app/api/org/ai-config/route")

    const res = await DELETE(new Request("http://localhost/api/org/ai-config", { method: "DELETE" }))
    expect(res.status).toBe(204)

    const deleteCall = vi.mocked(prisma.orgAiConfig.deleteMany).mock.calls[0][0]
    expect(deleteCall?.where?.organizationId).toBe("org-1")
  })

  it("returns 403 when role is member", async () => {
    mockCtx = { ...adminCtx, role: "member" }
    const { DELETE } = await import("@/app/api/org/ai-config/route")
    const res = await DELETE(new Request("http://localhost/api/org/ai-config", { method: "DELETE" }))
    expect(res.status).toBe(403)
  })
})

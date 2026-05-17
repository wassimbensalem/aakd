/**
 * CRM Integration Tests
 *
 * Covers all CRM-related API routes:
 *  - GET  /api/crm/[provider]/connect     — OAuth initiation
 *  - DELETE /api/crm/[provider]/connect   — Disconnect CRM
 *  - GET  /api/crm/[provider]/deals       — Deal search
 *  - GET  /api/crm/status                 — Integration status list
 *  - POST /api/crm/[provider]/webhook     — Inbound webhook handling
 *  - GET  /api/contracts/[id]/crm-link    — List deal links
 *  - POST /api/contracts/[id]/crm-link    — Create deal link
 *  - DELETE /api/contracts/[id]/crm-link/[linkId] — Unlink deal
 *
 * No real CRM credentials needed — all external provider calls are mocked.
 * Business logic (auth guards, role checks, org isolation, stage transitions)
 * is exercised end-to-end through the actual route handlers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prisma } from "@/lib/db/client"

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/middleware", () => ({
  resolveAuth: vi.fn(),
  requireWriteScope: vi.fn(() => null),
}))

vi.mock("@/lib/db/activity", () => ({
  writeActivity: vi.fn().mockResolvedValue(undefined),
}))

/**
 * getCrmProvider returns a provider instance. We mock the factory and each
 * test configures the provider methods it needs via mockReturnValue.
 */
vi.mock("@/lib/crm", () => ({
  getCrmProvider: vi.fn(),
}))

/**
 * Route helpers: normalizeProvider is a pure string function — replicated
 * inline so tests don't need real Prisma types. ensureFreshToken is mocked
 * to avoid real token refresh network calls.
 */
vi.mock("@/lib/crm/route-helpers", () => ({
  normalizeProvider: vi.fn((raw: string | undefined) => {
    if (!raw) return null
    const upper = raw.toUpperCase()
    return ["HUBSPOT", "SALESFORCE", "PIPEDRIVE"].includes(upper) ? upper : null
  }),
  getRedirectUri: vi.fn(
    (provider: string) => `http://localhost:3000/api/crm/${provider.toLowerCase()}/callback`,
  ),
  getWebhookUrl: vi.fn(
    (provider: string) => `http://localhost:3000/api/crm/${provider.toLowerCase()}/webhook`,
  ),
  ensureFreshToken: vi.fn(),
}))

// ─── Shared fixtures ──────────────────────────────────────────────────────────

import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { getCrmProvider } from "@/lib/crm"
import { ensureFreshToken } from "@/lib/crm/route-helpers"

/**
 * Reset the mock queues (mockResolvedValueOnce / mockReturnValueOnce) before
 * each test. vi.clearAllMocks() only clears call records — it does NOT flush
 * the Once queues. An unconsumed Once value from a previous test would bleed
 * into the next test's mock chain, shifting every return value by one and
 * producing cascading false failures.
 */
function resetMockQueues() {
  vi.mocked(resolveAuth).mockReset()
  vi.mocked(getCrmProvider).mockReset()
  vi.mocked(ensureFreshToken).mockReset()
  vi.mocked(requireWriteScope).mockReturnValue(null) // restore default after reset
}

const adminCtx = {
  userId: "user-admin",
  organizationId: "org-1",
  role: "admin",
  source: "session" as const,
  requestId: "req-test",
}

const viewerCtx = { ...adminCtx, role: "viewer" }
const memberCtx = { ...adminCtx, role: "member" }
const legalCtx = { ...adminCtx, role: "legal" }

/** A minimal mock CRM provider that can be configured per-test. */
function makeMockProvider(overrides: Record<string, unknown> = {}) {
  return {
    authorizationUrl: vi.fn().mockReturnValue("https://crm.example.com/oauth?state=abc"),
    exchangeCode: vi.fn(),
    refreshAccessToken: vi.fn(),
    searchDeals: vi.fn().mockResolvedValue([]),
    getDeal: vi.fn().mockResolvedValue(null),
    syncDealStage: vi.fn(),
    registerWebhook: vi.fn(),
    parseWebhookEvent: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}

const mockIntegration = {
  id: "integration-1",
  provider: "HUBSPOT",
  organizationId: "org-1",
  accessToken: "enc:token",
  refreshToken: "enc:refresh",
  tokenExpiresAt: new Date(Date.now() + 3600_000), // 1 hour from now
  portalId: "portal-123",
  instanceUrl: null,
  connectedById: "user-admin",
  autoCreateStage: null,
  syncOnActiveStage: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const mockContract = {
  id: "contract-1",
  organizationId: "org-1",
  status: "AWAITING_SIGNATURE",
}

const mockLink = {
  id: "link-1",
  contractId: "contract-1",
  integrationId: "integration-1",
  provider: "HUBSPOT",
  externalDealId: "deal-42",
  externalDealName: "Big Deal",
  externalDealUrl: "https://app.hubspot.com/contacts/portal-123/deal/deal-42",
  lastSyncedAt: null,
  lastSyncStatus: null,
  createdAt: new Date(),
  createdBy: { name: "Admin User" },
  integration: { provider: "HUBSPOT" },
  contract: { id: "contract-1", status: "AWAITING_SIGNATURE" },
}

// ─── GET /api/crm/[provider]/connect ──────────────────────────────────────────

describe("GET /api/crm/[provider]/connect", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/crm/[provider]/connect/route")
    const res = await GET(new Request("http://localhost/api/crm/hubspot/connect"), {
      params: { provider: "hubspot" },
    })
    expect(res.status).toBe(401)
  })

  it("returns 403 when user has member role (below legal)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    const { GET } = await import("@/app/api/crm/[provider]/connect/route")
    const res = await GET(new Request("http://localhost/api/crm/hubspot/connect"), {
      params: { provider: "hubspot" },
    })
    expect(res.status).toBe(403)
  })

  it("returns 400 for an invalid provider slug", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { GET } = await import("@/app/api/crm/[provider]/connect/route")
    const res = await GET(new Request("http://localhost/api/crm/bogus/connect"), {
      params: { provider: "bogus" },
    })
    expect(res.status).toBe(400)
  })

  it("returns 503 when CRM credentials are not configured", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(getCrmProvider).mockReturnValueOnce(
      makeMockProvider({
        authorizationUrl: vi.fn().mockImplementation(() => {
          throw new Error("HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET are required")
        }),
      }) as any,
    )
    const { GET } = await import("@/app/api/crm/[provider]/connect/route")
    const res = await GET(new Request("http://localhost/api/crm/hubspot/connect"), {
      params: { provider: "hubspot" },
    })
    expect(res.status).toBe(503)
  })

  it("returns 302 redirect with state cookie when credentials are configured", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(getCrmProvider).mockReturnValueOnce(makeMockProvider() as any)
    const { GET } = await import("@/app/api/crm/[provider]/connect/route")
    const res = await GET(new Request("http://localhost/api/crm/hubspot/connect"), {
      params: { provider: "hubspot" },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get("Location")).toContain("crm.example.com/oauth")
    // State cookie must be set so we can verify it in the callback
    const cookie = res.headers.get("Set-Cookie") ?? ""
    expect(cookie).toContain("crm_oauth_state=")
    expect(cookie).toContain("HttpOnly")
  })
})

// ─── DELETE /api/crm/[provider]/connect ──────────────────────────────────────

describe("DELETE /api/crm/[provider]/connect", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { DELETE } = await import("@/app/api/crm/[provider]/connect/route")
    const res = await DELETE(new Request("http://localhost/api/crm/hubspot/connect", { method: "DELETE" }), {
      params: { provider: "hubspot" },
    })
    expect(res.status).toBe(401)
  })

  it("returns 403 when user has member role (below legal)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    const { DELETE } = await import("@/app/api/crm/[provider]/connect/route")
    const res = await DELETE(new Request("http://localhost/api/crm/hubspot/connect", { method: "DELETE" }), {
      params: { provider: "hubspot" },
    })
    expect(res.status).toBe(403)
  })

  it("returns 404 when integration is not connected", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.crmIntegration.findUnique).mockResolvedValueOnce(null)
    const { DELETE } = await import("@/app/api/crm/[provider]/connect/route")
    const res = await DELETE(new Request("http://localhost/api/crm/hubspot/connect", { method: "DELETE" }), {
      params: { provider: "hubspot" },
    })
    expect(res.status).toBe(404)
  })

  it("returns 204 and cascades deletion of CrmLink rows", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.crmIntegration.findUnique).mockResolvedValueOnce({
      id: "integration-1",
    } as any)
    vi.mocked(prisma.crmLink.deleteMany).mockResolvedValueOnce({ count: 2 })
    vi.mocked(prisma.crmIntegration.delete).mockResolvedValueOnce(mockIntegration)
    const { DELETE } = await import("@/app/api/crm/[provider]/connect/route")
    const res = await DELETE(new Request("http://localhost/api/crm/hubspot/connect", { method: "DELETE" }), {
      params: { provider: "hubspot" },
    })
    expect(res.status).toBe(204)
    expect(prisma.crmLink.deleteMany).toHaveBeenCalledWith({
      where: { integrationId: "integration-1" },
    })
    expect(prisma.crmIntegration.delete).toHaveBeenCalledWith({
      where: { id: "integration-1" },
    })
  })
})

// ─── GET /api/crm/[provider]/deals ───────────────────────────────────────────

describe("GET /api/crm/[provider]/deals", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/crm/[provider]/deals/route")
    const res = await GET(new Request("http://localhost/api/crm/hubspot/deals?q=test"), {
      params: { provider: "hubspot" },
    })
    expect(res.status).toBe(401)
  })

  it("returns 400 when query string is missing", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { GET } = await import("@/app/api/crm/[provider]/deals/route")
    const res = await GET(new Request("http://localhost/api/crm/hubspot/deals"), {
      params: { provider: "hubspot" },
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("missing_query")
  })

  it("returns 400 for an invalid provider", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { GET } = await import("@/app/api/crm/[provider]/deals/route")
    const res = await GET(new Request("http://localhost/api/crm/badprovider/deals?q=test"), {
      params: { provider: "badprovider" },
    })
    expect(res.status).toBe(400)
  })

  it("returns 404 when CRM integration is not connected for this org", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.crmIntegration.findUnique).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/crm/[provider]/deals/route")
    const res = await GET(new Request("http://localhost/api/crm/hubspot/deals?q=Acme"), {
      params: { provider: "hubspot" },
    })
    expect(res.status).toBe(404)
  })

  it("returns 502 when token refresh fails", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.crmIntegration.findUnique).mockResolvedValueOnce(mockIntegration as any)
    vi.mocked(ensureFreshToken).mockRejectedValueOnce(new Error("refresh_failed"))
    const { GET } = await import("@/app/api/crm/[provider]/deals/route")
    const res = await GET(new Request("http://localhost/api/crm/hubspot/deals?q=Acme"), {
      params: { provider: "hubspot" },
    })
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe("token_refresh_failed")
  })

  it("returns 502 when the upstream deal search fails", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.crmIntegration.findUnique).mockResolvedValueOnce(mockIntegration as any)
    vi.mocked(ensureFreshToken).mockResolvedValueOnce(mockIntegration as any)
    vi.mocked(getCrmProvider).mockReturnValueOnce(
      makeMockProvider({
        searchDeals: vi.fn().mockRejectedValueOnce(new Error("upstream error")),
      }) as any,
    )
    const { GET } = await import("@/app/api/crm/[provider]/deals/route")
    const res = await GET(new Request("http://localhost/api/crm/hubspot/deals?q=Acme"), {
      params: { provider: "hubspot" },
    })
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe("search_failed")
  })

  it("returns 200 with deals when the integration is connected and query succeeds", async () => {
    const mockDeals = [
      { id: "deal-1", name: "Acme SaaS", stage: "contract_sent", value: 5000, currency: "USD", counterpartyName: "Acme Corp", url: "https://app.hubspot.com/deal/1" },
    ]
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.crmIntegration.findUnique).mockResolvedValueOnce(mockIntegration as any)
    vi.mocked(ensureFreshToken).mockResolvedValueOnce(mockIntegration as any)
    vi.mocked(getCrmProvider).mockReturnValueOnce(
      makeMockProvider({
        searchDeals: vi.fn().mockResolvedValueOnce(mockDeals),
      }) as any,
    )
    const { GET } = await import("@/app/api/crm/[provider]/deals/route")
    const res = await GET(new Request("http://localhost/api/crm/hubspot/deals?q=Acme"), {
      params: { provider: "hubspot" },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deals).toHaveLength(1)
    expect(body.deals[0].name).toBe("Acme SaaS")
  })
})

// ─── GET /api/crm/status ──────────────────────────────────────────────────────

describe("GET /api/crm/status", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/crm/status/route")
    const res = await GET(new Request("http://localhost/api/crm/status"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when user is a viewer (below member)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(viewerCtx)
    const { GET } = await import("@/app/api/crm/status/route")
    const res = await GET(new Request("http://localhost/api/crm/status"))
    expect(res.status).toBe(403)
  })

  it("returns 200 with an empty array when no CRMs are connected", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.crmIntegration.findMany).mockResolvedValueOnce([])
    const { GET } = await import("@/app/api/crm/status/route")
    const res = await GET(new Request("http://localhost/api/crm/status"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.integrations).toEqual([])
  })

  it("returns 200 with connected integrations including connectedBy name", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.crmIntegration.findMany).mockResolvedValueOnce([
      {
        provider: "HUBSPOT",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        portalId: "portal-123",
        instanceUrl: null,
        autoCreateStage: null,
        syncOnActiveStage: "Won",
        connectedBy: { name: "Alice Admin" },
      } as any,
    ])
    const { GET } = await import("@/app/api/crm/status/route")
    const res = await GET(new Request("http://localhost/api/crm/status"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.integrations).toHaveLength(1)
    expect(body.integrations[0]).toMatchObject({
      provider: "HUBSPOT",
      syncOnActiveStage: "Won",
      connectedBy: { name: "Alice Admin" },
    })
  })
})

// ─── POST /api/crm/[provider]/webhook ────────────────────────────────────────

describe("POST /api/crm/[provider]/webhook", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 404 for SALESFORCE (no webhook support — polling only)", async () => {
    const { POST } = await import("@/app/api/crm/[provider]/webhook/route")
    const res = await POST(
      new Request("http://localhost/api/crm/salesforce/webhook", { method: "POST", body: "{}" }),
      { params: { provider: "salesforce" } },
    )
    expect(res.status).toBe(404)
  })

  it("returns 200 when no org has the provider connected (accept silently — avoid disabling webhook subscriptions)", async () => {
    vi.mocked(prisma.crmIntegration.findMany).mockResolvedValueOnce([])
    const { POST } = await import("@/app/api/crm/[provider]/webhook/route")
    const res = await POST(
      new Request("http://localhost/api/crm/hubspot/webhook", { method: "POST", body: "{}" }),
      { params: { provider: "hubspot" } },
    )
    expect(res.status).toBe(200)
  })

  it("returns 200 when HMAC verification fails (provider returns null from parseWebhookEvent)", async () => {
    vi.mocked(prisma.crmIntegration.findMany).mockResolvedValueOnce([mockIntegration as any])
    vi.mocked(getCrmProvider).mockReturnValueOnce(
      makeMockProvider({
        // Signature mismatch → parseWebhookEvent returns null
        parseWebhookEvent: vi.fn().mockResolvedValueOnce(null),
      }) as any,
    )
    const { POST } = await import("@/app/api/crm/[provider]/webhook/route")
    const res = await POST(
      new Request("http://localhost/api/crm/hubspot/webhook", {
        method: "POST",
        body: JSON.stringify([{ subscriptionType: "deal.propertyChange", propertyName: "dealstage" }]),
      }),
      { params: { provider: "hubspot" } },
    )
    expect(res.status).toBe(200)
  })

  it("updates CrmLink lastSyncedAt when a valid deal stage event arrives (stage does not match syncOnActiveStage)", async () => {
    const integrationWithStage = { ...mockIntegration, syncOnActiveStage: "Won" }

    vi.mocked(prisma.crmIntegration.findMany).mockResolvedValueOnce([integrationWithStage as any])
    vi.mocked(getCrmProvider).mockReturnValueOnce(
      makeMockProvider({
        parseWebhookEvent: vi.fn().mockResolvedValueOnce({
          dealId: "deal-42",
          dealName: "Big Deal",
          stage: "qualified", // ≠ "Won"
          value: 5000,
          currency: "USD",
        }),
      }) as any,
    )
    vi.mocked(prisma.crmLink.findMany).mockResolvedValueOnce([
      { id: "link-1", contractId: "contract-1", contract: { id: "contract-1", status: "AWAITING_SIGNATURE" } } as any,
    ])
    vi.mocked(prisma.crmLink.update).mockResolvedValueOnce(mockLink as any)

    const { POST } = await import("@/app/api/crm/[provider]/webhook/route")
    const res = await POST(
      new Request("http://localhost/api/crm/hubspot/webhook", {
        method: "POST",
        headers: { "x-hubspot-portal-id": "portal-123" },
        body: "{}",
      }),
      { params: { provider: "hubspot" } },
    )
    expect(res.status).toBe(200)
    expect(prisma.crmLink.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "link-1" },
        data: expect.objectContaining({ lastSyncStatus: "success" }),
      }),
    )
    // Contract must NOT have been transitioned (stage mismatch)
    expect(prisma.contract.update).not.toHaveBeenCalled()
  })

  it("transitions linked contract to ACTIVE when deal stage matches syncOnActiveStage", async () => {
    const integrationWithStage = { ...mockIntegration, syncOnActiveStage: "Won" }

    vi.mocked(prisma.crmIntegration.findMany).mockResolvedValueOnce([integrationWithStage as any])
    vi.mocked(getCrmProvider).mockReturnValueOnce(
      makeMockProvider({
        parseWebhookEvent: vi.fn().mockResolvedValueOnce({
          dealId: "deal-42",
          dealName: "Big Deal",
          stage: "Won", // matches syncOnActiveStage — triggers contract ACTIVE
          value: 5000,
          currency: "USD",
        }),
      }) as any,
    )
    vi.mocked(prisma.crmLink.findMany).mockResolvedValueOnce([
      { id: "link-1", contractId: "contract-1", contract: { id: "contract-1", status: "AWAITING_SIGNATURE" } } as any,
    ])
    vi.mocked(prisma.crmLink.update).mockResolvedValueOnce(mockLink as any)
    vi.mocked(prisma.contract.update).mockResolvedValueOnce({ ...mockContract, status: "ACTIVE" } as any)

    const { POST } = await import("@/app/api/crm/[provider]/webhook/route")
    const res = await POST(
      new Request("http://localhost/api/crm/hubspot/webhook", {
        method: "POST",
        headers: { "x-hubspot-portal-id": "portal-123" },
        body: "{}",
      }),
      { params: { provider: "hubspot" } },
    )
    expect(res.status).toBe(200)
    expect(prisma.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "contract-1", status: "AWAITING_SIGNATURE" },
        data: { status: "ACTIVE" },
      }),
    )
  })

  it("returns 200 for valid Pipedrive webhook (HMAC mocked via parseWebhookEvent)", async () => {
    vi.mocked(prisma.crmIntegration.findMany).mockResolvedValueOnce([
      { ...mockIntegration, provider: "PIPEDRIVE", syncOnActiveStage: null } as any,
    ])
    vi.mocked(getCrmProvider).mockReturnValueOnce(
      makeMockProvider({
        parseWebhookEvent: vi.fn().mockResolvedValueOnce({
          dealId: "deal-99",
          dealName: "Pipedrive Deal",
          stage: "Won",
          value: 10000,
          currency: "EUR",
        }),
      }) as any,
    )
    vi.mocked(prisma.crmLink.findMany).mockResolvedValueOnce([])

    const { POST } = await import("@/app/api/crm/[provider]/webhook/route")
    const res = await POST(
      new Request("http://localhost/api/crm/pipedrive/webhook", {
        method: "POST",
        headers: { "x-pipedrive-signature": "fake-sig" },
        body: JSON.stringify({ current: { id: 99, stage_id: 5 }, previous: { id: 99, stage_id: 4 } }),
      }),
      { params: { provider: "pipedrive" } },
    )
    expect(res.status).toBe(200)
  })
})

// ─── GET /api/contracts/[id]/crm-link ────────────────────────────────────────

describe("GET /api/contracts/[id]/crm-link", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/contracts/[id]/crm-link/route")
    const res = await GET(new Request("http://localhost/api/contracts/contract-1/crm-link"), {
      params: { id: "contract-1" },
    })
    expect(res.status).toBe(401)
  })

  it("returns 404 when contract belongs to a different org (org isolation)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      id: "contract-1",
      organizationId: "org-2", // ← different org
    } as any)
    const { GET } = await import("@/app/api/contracts/[id]/crm-link/route")
    const res = await GET(new Request("http://localhost/api/contracts/contract-1/crm-link"), {
      params: { id: "contract-1" },
    })
    expect(res.status).toBe(404)
  })

  it("returns 404 when contract does not exist", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/contracts/[id]/crm-link/route")
    const res = await GET(new Request("http://localhost/api/contracts/contract-1/crm-link"), {
      params: { id: "contract-1" },
    })
    expect(res.status).toBe(404)
  })

  it("returns 200 with the deal links for a contract", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      id: "contract-1",
      organizationId: "org-1",
    } as any)
    vi.mocked(prisma.crmLink.findMany).mockResolvedValueOnce([mockLink as any])
    const { GET } = await import("@/app/api/contracts/[id]/crm-link/route")
    const res = await GET(new Request("http://localhost/api/contracts/contract-1/crm-link"), {
      params: { id: "contract-1" },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.links).toHaveLength(1)
    expect(body.links[0]).toMatchObject({
      provider: "HUBSPOT",
      externalDealId: "deal-42",
      externalDealName: "Big Deal",
    })
  })
})

// ─── POST /api/contracts/[id]/crm-link ───────────────────────────────────────

describe("POST /api/contracts/[id]/crm-link", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/contracts/[id]/crm-link/route")
    const res = await POST(
      new Request("http://localhost/api/contracts/contract-1/crm-link", {
        method: "POST",
        body: JSON.stringify({ provider: "HUBSPOT", externalDealId: "deal-1" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { id: "contract-1" } },
    )
    expect(res.status).toBe(401)
  })

  it("returns 403 when user is a viewer (below member, cannot link)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(viewerCtx)
    const { POST } = await import("@/app/api/contracts/[id]/crm-link/route")
    const res = await POST(
      new Request("http://localhost/api/contracts/contract-1/crm-link", {
        method: "POST",
        body: JSON.stringify({ provider: "HUBSPOT", externalDealId: "deal-1" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { id: "contract-1" } },
    )
    expect(res.status).toBe(403)
  })

  it("returns 422 when body is missing both externalDealId and dealId", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { POST } = await import("@/app/api/contracts/[id]/crm-link/route")
    const res = await POST(
      new Request("http://localhost/api/contracts/contract-1/crm-link", {
        method: "POST",
        body: JSON.stringify({ provider: "HUBSPOT" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { id: "contract-1" } },
    )
    expect(res.status).toBe(422)
  })

  it("returns 404 when contract does not exist", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/contracts/[id]/crm-link/route")
    const res = await POST(
      new Request("http://localhost/api/contracts/contract-1/crm-link", {
        method: "POST",
        body: JSON.stringify({ provider: "HUBSPOT", externalDealId: "deal-1" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { id: "contract-1" } },
    )
    expect(res.status).toBe(404)
  })

  it("returns 404 when the CRM integration is not connected", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      id: "contract-1",
      organizationId: "org-1",
    } as any)
    vi.mocked(prisma.crmIntegration.findUnique).mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/contracts/[id]/crm-link/route")
    const res = await POST(
      new Request("http://localhost/api/contracts/contract-1/crm-link", {
        method: "POST",
        body: JSON.stringify({ provider: "HUBSPOT", externalDealId: "deal-1" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { id: "contract-1" } },
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("not_connected")
  })

  it("returns 502 when upstream deal lookup fails", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      id: "contract-1",
      organizationId: "org-1",
    } as any)
    vi.mocked(prisma.crmIntegration.findUnique).mockResolvedValueOnce(mockIntegration as any)
    vi.mocked(ensureFreshToken).mockResolvedValueOnce(mockIntegration as any)
    vi.mocked(getCrmProvider).mockReturnValueOnce(
      makeMockProvider({
        getDeal: vi.fn().mockRejectedValueOnce(new Error("upstream error")),
      }) as any,
    )
    const { POST } = await import("@/app/api/contracts/[id]/crm-link/route")
    const res = await POST(
      new Request("http://localhost/api/contracts/contract-1/crm-link", {
        method: "POST",
        body: JSON.stringify({ provider: "HUBSPOT", externalDealId: "deal-1" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { id: "contract-1" } },
    )
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe("deal_lookup_failed")
  })

  it("returns 409 when contract is already linked to this deal (P2002 unique constraint)", async () => {
    const { Prisma } = await import("@prisma/client")
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      id: "contract-1",
      organizationId: "org-1",
    } as any)
    vi.mocked(prisma.crmIntegration.findUnique).mockResolvedValueOnce(mockIntegration as any)
    vi.mocked(ensureFreshToken).mockResolvedValueOnce(mockIntegration as any)
    vi.mocked(getCrmProvider).mockReturnValueOnce(
      makeMockProvider({
        getDeal: vi.fn().mockResolvedValueOnce({
          id: "deal-42",
          name: "Big Deal",
          url: "https://app.hubspot.com/deal/42",
        }),
      }) as any,
    )
    // Simulate unique constraint violation
    const uniqueError = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "5.x" },
    )
    vi.mocked(prisma.crmLink.create).mockRejectedValueOnce(uniqueError)
    const { POST } = await import("@/app/api/contracts/[id]/crm-link/route")
    const res = await POST(
      new Request("http://localhost/api/contracts/contract-1/crm-link", {
        method: "POST",
        body: JSON.stringify({ provider: "HUBSPOT", externalDealId: "deal-42" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { id: "contract-1" } },
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe("already_linked")
  })

  it("returns 201 with the new link when successfully linked to a HubSpot deal", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      id: "contract-1",
      organizationId: "org-1",
    } as any)
    vi.mocked(prisma.crmIntegration.findUnique).mockResolvedValueOnce(mockIntegration as any)
    vi.mocked(ensureFreshToken).mockResolvedValueOnce(mockIntegration as any)
    vi.mocked(getCrmProvider).mockReturnValueOnce(
      makeMockProvider({
        getDeal: vi.fn().mockResolvedValueOnce({
          id: "deal-42",
          name: "Big Deal",
          url: "https://app.hubspot.com/deal/42",
        }),
      }) as any,
    )
    vi.mocked(prisma.crmLink.create).mockResolvedValueOnce({
      id: "link-1",
      provider: "HUBSPOT",
      externalDealId: "deal-42",
      externalDealName: "Big Deal",
      externalDealUrl: "https://app.hubspot.com/deal/42",
      lastSyncedAt: null,
      lastSyncStatus: null,
      createdAt: new Date(),
      createdBy: { name: "Admin User" },
    } as any)
    const { POST } = await import("@/app/api/contracts/[id]/crm-link/route")
    const res = await POST(
      new Request("http://localhost/api/contracts/contract-1/crm-link", {
        method: "POST",
        body: JSON.stringify({ provider: "HUBSPOT", externalDealId: "deal-42" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { id: "contract-1" } },
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.link).toMatchObject({
      provider: "HUBSPOT",
      externalDealId: "deal-42",
      externalDealName: "Big Deal",
    })
  })
})

// ─── DELETE /api/contracts/[id]/crm-link/[linkId] ────────────────────────────

describe("DELETE /api/contracts/[id]/crm-link/[linkId]", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { DELETE } = await import("@/app/api/contracts/[id]/crm-link/[linkId]/route")
    const res = await DELETE(
      new Request("http://localhost/api/contracts/contract-1/crm-link/link-1", { method: "DELETE" }),
      { params: { id: "contract-1", linkId: "link-1" } },
    )
    expect(res.status).toBe(401)
  })

  it("returns 403 when user has member role (only admin/legal can unlink)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    const { DELETE } = await import("@/app/api/contracts/[id]/crm-link/[linkId]/route")
    const res = await DELETE(
      new Request("http://localhost/api/contracts/contract-1/crm-link/link-1", { method: "DELETE" }),
      { params: { id: "contract-1", linkId: "link-1" } },
    )
    expect(res.status).toBe(403)
  })

  it("returns 404 when link belongs to a different org (org isolation)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.crmLink.findUnique).mockResolvedValueOnce({
      id: "link-1",
      contractId: "contract-1",
      provider: "HUBSPOT",
      externalDealId: "deal-42",
      contract: { organizationId: "org-2" }, // ← different org
    } as any)
    const { DELETE } = await import("@/app/api/contracts/[id]/crm-link/[linkId]/route")
    const res = await DELETE(
      new Request("http://localhost/api/contracts/contract-1/crm-link/link-1", { method: "DELETE" }),
      { params: { id: "contract-1", linkId: "link-1" } },
    )
    expect(res.status).toBe(404)
  })

  it("returns 204 and writes activity on successful unlink", async () => {
    const { writeActivity } = await import("@/lib/db/activity")
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.crmLink.findUnique).mockResolvedValueOnce({
      id: "link-1",
      contractId: "contract-1",
      provider: "HUBSPOT",
      externalDealId: "deal-42",
      contract: { organizationId: "org-1" },
    } as any)
    vi.mocked(prisma.crmLink.delete).mockResolvedValueOnce(mockLink as any)
    const { DELETE } = await import("@/app/api/contracts/[id]/crm-link/[linkId]/route")
    const res = await DELETE(
      new Request("http://localhost/api/contracts/contract-1/crm-link/link-1", { method: "DELETE" }),
      { params: { id: "contract-1", linkId: "link-1" } },
    )
    expect(res.status).toBe(204)
    expect(prisma.crmLink.delete).toHaveBeenCalledWith({ where: { id: "link-1" } })
    expect(writeActivity).toHaveBeenCalledWith(
      "contract-1",
      "user-admin",
      "CRM_UNLINKED",
      expect.stringContaining("HUBSPOT"),
      expect.objectContaining({ provider: "HUBSPOT", dealId: "deal-42" }),
    )
  })
})

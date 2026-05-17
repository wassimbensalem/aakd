/**
 * CRM Extended Integration Tests
 *
 * Covers CRM routes NOT covered by crm.test.ts:
 *  - GET  /api/crm/[provider]/callback    — OAuth code exchange + upsert integration
 *  - PATCH /api/crm/[provider]/integration — Update autoCreateStage / syncOnActiveStage
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

vi.mock("@/lib/crm", () => ({
  getCrmProvider: vi.fn(),
}))

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

vi.mock("@/lib/crm/crypto", () => ({
  encryptToken: vi.fn((token: string) => `enc:${token}`),
  decryptToken: vi.fn((enc: string) => enc.replace(/^enc:/, "")),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

import { resolveAuth } from "@/lib/auth/middleware"
import { getCrmProvider } from "@/lib/crm"

function resetMockQueues() {
  vi.mocked(resolveAuth).mockReset()
  vi.mocked(getCrmProvider).mockReset()
}

const adminCtx = {
  userId: "user-admin",
  organizationId: "org-1",
  role: "admin",
  source: "session" as const,
  requestId: "req-test",
}

const memberCtx = { ...adminCtx, role: "member" }
const viewerCtx = { ...adminCtx, role: "viewer" }
const legalCtx = { ...adminCtx, role: "legal" }

function makeMockProvider(overrides: Record<string, unknown> = {}) {
  return {
    authorizationUrl: vi.fn().mockReturnValue("https://crm.example.com/oauth?state=abc"),
    exchangeCode: vi.fn(),
    refreshAccessToken: vi.fn(),
    searchDeals: vi.fn().mockResolvedValue([]),
    getDeal: vi.fn().mockResolvedValue(null),
    syncDealStage: vi.fn(),
    registerWebhook: vi.fn().mockResolvedValue(null),
    parseWebhookEvent: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}

const mockIntegration = {
  id: "integration-1",
  provider: "HUBSPOT",
  organizationId: "org-1",
  accessToken: "enc:access-token",
  refreshToken: "enc:refresh-token",
  tokenExpiresAt: null,
  portalId: "portal-123",
  instanceUrl: null,
  connectedById: "user-admin",
  autoCreateStage: null,
  syncOnActiveStage: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  connectedBy: { name: "Admin User" },
}

// ─── GET /api/crm/[provider]/callback ────────────────────────────────────────

describe("GET /api/crm/[provider]/callback", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/crm/[provider]/callback/route")
    const res = await GET(
      new Request("http://localhost/api/crm/hubspot/callback?code=abc&state=xyz"),
      { params: { provider: "hubspot" } },
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 for an invalid provider", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { GET } = await import("@/app/api/crm/[provider]/callback/route")
    const res = await GET(
      new Request("http://localhost/api/crm/bogus/callback?code=abc&state=xyz"),
      { params: { provider: "bogus" } },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("invalid_provider")
  })

  it("returns 403 when user has member role (below legal)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    const { GET } = await import("@/app/api/crm/[provider]/callback/route")
    const res = await GET(
      new Request("http://localhost/api/crm/hubspot/callback?code=abc&state=xyz"),
      { params: { provider: "hubspot" } },
    )
    expect(res.status).toBe(403)
  })

  it("redirects with missing_params error when code or state is missing", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { GET } = await import("@/app/api/crm/[provider]/callback/route")
    const res = await GET(
      new Request("http://localhost/api/crm/hubspot/callback"),
      { params: { provider: "hubspot" } },
    )
    expect(res.status).toBe(302)
    const location = res.headers.get("Location") ?? ""
    expect(location).toContain("missing_params")
  })

  it("redirects with state_mismatch error when cookie state does not match query state", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { GET } = await import("@/app/api/crm/[provider]/callback/route")
    const res = await GET(
      new Request("http://localhost/api/crm/hubspot/callback?code=abc&state=state-123", {
        headers: { cookie: "crm_oauth_state=state-WRONG" },
      }),
      { params: { provider: "hubspot" } },
    )
    expect(res.status).toBe(302)
    const location = res.headers.get("Location") ?? ""
    expect(location).toContain("state_mismatch")
  })

  it("redirects with exchange_failed error when code exchange throws", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(getCrmProvider).mockReturnValueOnce(
      makeMockProvider({
        exchangeCode: vi.fn().mockRejectedValueOnce(new Error("invalid_grant")),
      }) as any,
    )
    const { GET } = await import("@/app/api/crm/[provider]/callback/route")
    const res = await GET(
      new Request("http://localhost/api/crm/hubspot/callback?code=bad-code&state=state-abc", {
        headers: { cookie: "crm_oauth_state=state-abc" },
      }),
      { params: { provider: "hubspot" } },
    )
    expect(res.status).toBe(302)
    const location = res.headers.get("Location") ?? ""
    expect(location).toContain("exchange_failed")
  })

  it("redirects with connected=HUBSPOT after successful code exchange and integration upsert", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(getCrmProvider)
      .mockReturnValueOnce(
        makeMockProvider({
          exchangeCode: vi.fn().mockResolvedValueOnce({
            accessToken: "access-token",
            refreshToken: "refresh-token",
            expiresAt: new Date(Date.now() + 3600_000),
            portalId: "portal-123",
            instanceUrl: null,
          }),
        }) as any,
      )
      // Second call: getCrmProvider for registerWebhook
      .mockReturnValueOnce(
        makeMockProvider({
          registerWebhook: vi.fn().mockResolvedValueOnce("webhook-sub-123"),
        }) as any,
      )
    vi.mocked(prisma.crmIntegration.upsert).mockResolvedValueOnce(mockIntegration as any)
    const { GET } = await import("@/app/api/crm/[provider]/callback/route")
    const res = await GET(
      new Request("http://localhost/api/crm/hubspot/callback?code=valid-code&state=state-abc", {
        headers: { cookie: "crm_oauth_state=state-abc" },
      }),
      { params: { provider: "hubspot" } },
    )
    expect(res.status).toBe(302)
    const location = res.headers.get("Location") ?? ""
    expect(location).toContain("connected=HUBSPOT")
    expect(prisma.crmIntegration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          organizationId: "org-1",
          provider: "HUBSPOT",
          connectedById: "user-admin",
        }),
      }),
    )
  })

  it("still redirects with connected=SALESFORCE even when webhook registration fails (best-effort)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(getCrmProvider).mockReturnValueOnce(
      makeMockProvider({
        exchangeCode: vi.fn().mockResolvedValueOnce({
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresAt: null,
          instanceUrl: "https://myorg.salesforce.com",
          portalId: null,
        }),
      }) as any,
    )
    vi.mocked(prisma.crmIntegration.upsert).mockResolvedValueOnce({
      ...mockIntegration,
      provider: "SALESFORCE",
    } as any)
    const { GET } = await import("@/app/api/crm/[provider]/callback/route")
    const res = await GET(
      new Request("http://localhost/api/crm/salesforce/callback?code=sf-code&state=state-sf", {
        headers: { cookie: "crm_oauth_state=state-sf" },
      }),
      { params: { provider: "salesforce" } },
    )
    expect(res.status).toBe(302)
    const location = res.headers.get("Location") ?? ""
    expect(location).toContain("connected=SALESFORCE")
  })

  it("stores null refreshToken when provider does not return one", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(getCrmProvider)
      .mockReturnValueOnce(
        makeMockProvider({
          exchangeCode: vi.fn().mockResolvedValueOnce({
            accessToken: "access-token",
            refreshToken: undefined, // no refresh token
            expiresAt: null,
            portalId: "portal-456",
            instanceUrl: null,
          }),
        }) as any,
      )
      .mockReturnValueOnce(makeMockProvider() as any)
    vi.mocked(prisma.crmIntegration.upsert).mockResolvedValueOnce(mockIntegration as any)
    const { GET } = await import("@/app/api/crm/[provider]/callback/route")
    const res = await GET(
      new Request("http://localhost/api/crm/hubspot/callback?code=code&state=state-x", {
        headers: { cookie: "crm_oauth_state=state-x" },
      }),
      { params: { provider: "hubspot" } },
    )
    expect(res.status).toBe(302)
    expect(prisma.crmIntegration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ refreshToken: null }),
      }),
    )
  })
})

// ─── PATCH /api/crm/[provider]/integration ────────────────────────────────────

describe("PATCH /api/crm/[provider]/integration", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { PATCH } = await import("@/app/api/crm/[provider]/integration/route")
    const res = await PATCH(
      new Request("http://localhost/api/crm/hubspot/integration", {
        method: "PATCH",
        body: JSON.stringify({ syncOnActiveStage: "Won" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { provider: "hubspot" } },
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 for an invalid provider", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { PATCH } = await import("@/app/api/crm/[provider]/integration/route")
    const res = await PATCH(
      new Request("http://localhost/api/crm/invalid/integration", {
        method: "PATCH",
        body: JSON.stringify({ syncOnActiveStage: "Won" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { provider: "invalid" } },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("invalid_provider")
  })

  it("returns 403 when user has member role (below legal)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    const { PATCH } = await import("@/app/api/crm/[provider]/integration/route")
    const res = await PATCH(
      new Request("http://localhost/api/crm/hubspot/integration", {
        method: "PATCH",
        body: JSON.stringify({ syncOnActiveStage: "Won" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { provider: "hubspot" } },
    )
    expect(res.status).toBe(403)
  })

  it("returns 403 when user has viewer role", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(viewerCtx)
    const { PATCH } = await import("@/app/api/crm/[provider]/integration/route")
    const res = await PATCH(
      new Request("http://localhost/api/crm/hubspot/integration", {
        method: "PATCH",
        body: JSON.stringify({ syncOnActiveStage: "Won" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { provider: "hubspot" } },
    )
    expect(res.status).toBe(403)
  })

  it("returns 400 when request body is not valid JSON", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { PATCH } = await import("@/app/api/crm/[provider]/integration/route")
    const res = await PATCH(
      new Request("http://localhost/api/crm/hubspot/integration", {
        method: "PATCH",
        body: "not-json",
        headers: { "Content-Type": "application/json" },
      }),
      { params: { provider: "hubspot" } },
    )
    expect(res.status).toBe(400)
  })

  it("returns 422 when syncOnActiveStage exceeds max length", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { PATCH } = await import("@/app/api/crm/[provider]/integration/route")
    const res = await PATCH(
      new Request("http://localhost/api/crm/hubspot/integration", {
        method: "PATCH",
        body: JSON.stringify({ syncOnActiveStage: "x".repeat(201) }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { provider: "hubspot" } },
    )
    expect(res.status).toBe(422)
  })

  it("returns 404 when the integration is not connected for this org", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.crmIntegration.findUnique).mockResolvedValueOnce(null)
    const { PATCH } = await import("@/app/api/crm/[provider]/integration/route")
    const res = await PATCH(
      new Request("http://localhost/api/crm/hubspot/integration", {
        method: "PATCH",
        body: JSON.stringify({ syncOnActiveStage: "Won" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { provider: "hubspot" } },
    )
    expect(res.status).toBe(404)
  })

  it("returns 200 with updated integration settings on success", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.crmIntegration.findUnique).mockResolvedValueOnce({
      id: "integration-1",
    } as any)
    vi.mocked(prisma.crmIntegration.update).mockResolvedValueOnce({
      provider: "HUBSPOT",
      createdAt: new Date("2026-01-01"),
      portalId: "portal-123",
      instanceUrl: null,
      autoCreateStage: "contract_sent",
      syncOnActiveStage: "Won",
      connectedBy: { name: "Admin User" },
    } as any)
    const { PATCH } = await import("@/app/api/crm/[provider]/integration/route")
    const res = await PATCH(
      new Request("http://localhost/api/crm/hubspot/integration", {
        method: "PATCH",
        body: JSON.stringify({ autoCreateStage: "contract_sent", syncOnActiveStage: "Won" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { provider: "hubspot" } },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      provider: "HUBSPOT",
      autoCreateStage: "contract_sent",
      syncOnActiveStage: "Won",
      connectedBy: { name: "Admin User" },
    })
    expect(prisma.crmIntegration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "integration-1" },
        data: expect.objectContaining({
          autoCreateStage: "contract_sent",
          syncOnActiveStage: "Won",
        }),
      }),
    )
  })

  it("allows setting syncOnActiveStage to null (disable auto-transition)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.crmIntegration.findUnique).mockResolvedValueOnce({ id: "integration-1" } as any)
    vi.mocked(prisma.crmIntegration.update).mockResolvedValueOnce({
      provider: "HUBSPOT",
      createdAt: new Date(),
      portalId: null,
      instanceUrl: null,
      autoCreateStage: null,
      syncOnActiveStage: null,
      connectedBy: { name: "Admin User" },
    } as any)
    const { PATCH } = await import("@/app/api/crm/[provider]/integration/route")
    const res = await PATCH(
      new Request("http://localhost/api/crm/hubspot/integration", {
        method: "PATCH",
        body: JSON.stringify({ syncOnActiveStage: null }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { provider: "hubspot" } },
    )
    expect(res.status).toBe(200)
    expect(prisma.crmIntegration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ syncOnActiveStage: null }),
      }),
    )
  })

  it("works with Salesforce provider as well", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(legalCtx)
    vi.mocked(prisma.crmIntegration.findUnique).mockResolvedValueOnce({ id: "sf-integration-1" } as any)
    vi.mocked(prisma.crmIntegration.update).mockResolvedValueOnce({
      provider: "SALESFORCE",
      createdAt: new Date(),
      portalId: null,
      instanceUrl: "https://myorg.salesforce.com",
      autoCreateStage: null,
      syncOnActiveStage: "Closed Won",
      connectedBy: { name: "Legal User" },
    } as any)
    const { PATCH } = await import("@/app/api/crm/[provider]/integration/route")
    const res = await PATCH(
      new Request("http://localhost/api/crm/salesforce/integration", {
        method: "PATCH",
        body: JSON.stringify({ syncOnActiveStage: "Closed Won" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { provider: "salesforce" } },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.provider).toBe("SALESFORCE")
    expect(body.instanceUrl).toBe("https://myorg.salesforce.com")
  })
})

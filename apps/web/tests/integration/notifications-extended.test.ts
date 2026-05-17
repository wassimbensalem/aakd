/**
 * Notifications Extended Integration Tests
 *
 * Covers all notification-related routes NOT covered by notifications.test.ts:
 *  - GET  /api/org/notification-channels        — List Slack/Teams channels
 *  - POST /api/org/notification-channels        — Create a channel
 *  - PATCH /api/org/notification-channels/[id]  — Update label / enabled
 *  - DELETE /api/org/notification-channels/[id] — Remove channel
 *  - GET  /api/org/webhooks                     — List outbound webhooks
 *  - POST /api/org/webhooks                     — Create outbound webhook
 *  - DELETE /api/org/webhooks/[id]              — Remove webhook
 *  - GET  /api/org/webhooks/[id]/deliveries     — Webhook delivery history
 *  - GET  /api/user/notification-preferences    — Get user preferences
 *  - PUT  /api/user/notification-preferences    — Update user preferences
 *  - GET  /api/user/unsubscribe                 — One-click email unsubscribe
 *  - GET  /api/notifications                    — In-app notification feed
 *  - POST /api/notifications/read-all           — Mark all read
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
 * The notification crypto module requires NOTIFICATION_ENCRYPTION_KEY env var.
 * Mock encrypt/decrypt so tests don't depend on that env var.
 */
vi.mock("@/lib/notifications/crypto", () => ({
  encrypt: vi.fn((s: string) => `enc:${s}`),
  decrypt: vi.fn((s: string) => s.replace(/^enc:/, "")),
  __resetKeyCacheForTests: vi.fn(),
}))

/**
 * validateWebhookUrl performs real DNS lookups. Mock it to return void (OK)
 * by default; individual tests can override to simulate SSRF rejection.
 */
vi.mock("@/lib/notifications/validate-webhook-url", () => ({
  validateWebhookUrl: vi.fn().mockResolvedValue(undefined),
}))

/**
 * verifyUnsubscribeToken is a pure HMAC function that requires BETTER_AUTH_SECRET.
 * Mock it so token-based tests don't depend on env vars.
 */
vi.mock("@/lib/notifications/unsubscribe-token", () => ({
  verifyUnsubscribeToken: vi.fn(),
  buildUnsubscribeToken: vi.fn().mockReturnValue("mock-token"),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { validateWebhookUrl } from "@/lib/notifications/validate-webhook-url"
import { verifyUnsubscribeToken } from "@/lib/notifications/unsubscribe-token"

function resetMockQueues() {
  vi.mocked(resolveAuth).mockReset()
  vi.mocked(requireWriteScope).mockReturnValue(null)
  vi.mocked(validateWebhookUrl).mockResolvedValue(undefined)
  vi.mocked(verifyUnsubscribeToken).mockReset()
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

const mockChannel = {
  id: "channel-1",
  channelType: "slack",
  label: "Engineering Slack",
  enabled: true,
  createdAt: new Date("2026-01-01"),
}

const mockWebhook = {
  id: "webhook-1",
  url: "enc:https://example.com/hook",
  label: "My Webhook",
  enabled: true,
  createdAt: new Date("2026-01-01"),
}

// ─── GET /api/org/notification-channels ──────────────────────────────────────

describe("GET /api/org/notification-channels", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/org/notification-channels/route")
    const res = await GET(new Request("http://localhost/api/org/notification-channels"))
    expect(res.status).toBe(401)
  })

  it("returns 200 with empty array when no channels are configured", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.orgNotificationChannel.findMany).mockResolvedValueOnce([])
    const { GET } = await import("@/app/api/org/notification-channels/route")
    const res = await GET(new Request("http://localhost/api/org/notification-channels"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.channels).toEqual([])
  })

  it("returns 200 with list of channels (does NOT expose webhookUrl)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    vi.mocked(prisma.orgNotificationChannel.findMany).mockResolvedValueOnce([mockChannel as any])
    const { GET } = await import("@/app/api/org/notification-channels/route")
    const res = await GET(new Request("http://localhost/api/org/notification-channels"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.channels).toHaveLength(1)
    expect(body.channels[0]).toMatchObject({
      id: "channel-1",
      channelType: "slack",
      label: "Engineering Slack",
      enabled: true,
    })
    // Must not leak the encrypted webhook URL
    expect(body.channels[0]).not.toHaveProperty("webhookUrl")
  })

  it("viewers can also read the channel list", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(viewerCtx)
    vi.mocked(prisma.orgNotificationChannel.findMany).mockResolvedValueOnce([])
    const { GET } = await import("@/app/api/org/notification-channels/route")
    const res = await GET(new Request("http://localhost/api/org/notification-channels"))
    expect(res.status).toBe(200)
  })
})

// ─── POST /api/org/notification-channels ─────────────────────────────────────

describe("POST /api/org/notification-channels", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/org/notification-channels/route")
    const res = await POST(
      new Request("http://localhost/api/org/notification-channels", {
        method: "POST",
        body: JSON.stringify({ channelType: "slack", webhookUrl: "https://hooks.slack.com/T/B/xxx", label: "Dev" }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 403 when user is a member (only admin can create channels)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    const { POST } = await import("@/app/api/org/notification-channels/route")
    const res = await POST(
      new Request("http://localhost/api/org/notification-channels", {
        method: "POST",
        body: JSON.stringify({ channelType: "slack", webhookUrl: "https://hooks.slack.com/T/B/xxx", label: "Dev" }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(403)
  })

  it("returns 403 when user is a legal (only admin)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(legalCtx)
    const { POST } = await import("@/app/api/org/notification-channels/route")
    const res = await POST(
      new Request("http://localhost/api/org/notification-channels", {
        method: "POST",
        body: JSON.stringify({ channelType: "slack", webhookUrl: "https://hooks.slack.com/T/B/xxx", label: "Dev" }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(403)
  })

  it("returns 422 when channelType is invalid", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { POST } = await import("@/app/api/org/notification-channels/route")
    const res = await POST(
      new Request("http://localhost/api/org/notification-channels", {
        method: "POST",
        body: JSON.stringify({ channelType: "discord", webhookUrl: "https://discord.com/api/webhooks/123", label: "Discord" }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(422)
  })

  it("returns 422 when webhookUrl fails SSRF validation", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(validateWebhookUrl).mockRejectedValueOnce(new Error("Private or internal URLs are not allowed"))
    const { POST } = await import("@/app/api/org/notification-channels/route")
    const res = await POST(
      new Request("http://localhost/api/org/notification-channels", {
        method: "POST",
        body: JSON.stringify({ channelType: "slack", webhookUrl: "https://192.168.1.1/hook", label: "Internal" }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain("not allowed")
  })

  it("returns 422 when the per-type channel limit (5) is reached", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.orgNotificationChannel.count).mockResolvedValueOnce(5)
    const { POST } = await import("@/app/api/org/notification-channels/route")
    const res = await POST(
      new Request("http://localhost/api/org/notification-channels", {
        method: "POST",
        body: JSON.stringify({ channelType: "slack", webhookUrl: "https://hooks.slack.com/T/B/xxx", label: "Dev 5" }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe("limit_reached")
  })

  it("returns 201 with the created channel (webhookUrl encrypted, not exposed)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.orgNotificationChannel.count).mockResolvedValueOnce(0)
    vi.mocked(prisma.orgNotificationChannel.create).mockResolvedValueOnce(mockChannel as any)
    const { POST } = await import("@/app/api/org/notification-channels/route")
    const res = await POST(
      new Request("http://localhost/api/org/notification-channels", {
        method: "POST",
        body: JSON.stringify({ channelType: "slack", webhookUrl: "https://hooks.slack.com/T/B/xxx", label: "Engineering Slack" }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({
      id: "channel-1",
      channelType: "slack",
      label: "Engineering Slack",
    })
    expect(body).not.toHaveProperty("webhookUrl")
  })
})

// ─── PATCH /api/org/notification-channels/[id] ───────────────────────────────

describe("PATCH /api/org/notification-channels/[id]", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { PATCH } = await import("@/app/api/org/notification-channels/[id]/route")
    const res = await PATCH(
      new Request("http://localhost/api/org/notification-channels/channel-1", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { id: "channel-1" } },
    )
    expect(res.status).toBe(401)
  })

  it("returns 403 when user is a member (only admin can update)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    const { PATCH } = await import("@/app/api/org/notification-channels/[id]/route")
    const res = await PATCH(
      new Request("http://localhost/api/org/notification-channels/channel-1", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { id: "channel-1" } },
    )
    expect(res.status).toBe(403)
  })

  it("returns 404 when channel belongs to different org", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.orgNotificationChannel.findUnique).mockResolvedValueOnce({
      id: "channel-1",
      organizationId: "org-2",
    } as any)
    const { PATCH } = await import("@/app/api/org/notification-channels/[id]/route")
    const res = await PATCH(
      new Request("http://localhost/api/org/notification-channels/channel-1", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { id: "channel-1" } },
    )
    expect(res.status).toBe(404)
  })

  it("returns 422 when neither label nor enabled is provided", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.orgNotificationChannel.findUnique).mockResolvedValueOnce({
      id: "channel-1",
      organizationId: "org-1",
    } as any)
    const { PATCH } = await import("@/app/api/org/notification-channels/[id]/route")
    const res = await PATCH(
      new Request("http://localhost/api/org/notification-channels/channel-1", {
        method: "PATCH",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { id: "channel-1" } },
    )
    expect(res.status).toBe(422)
  })

  it("returns 200 with updated channel on success", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.orgNotificationChannel.findUnique).mockResolvedValueOnce({
      id: "channel-1",
      organizationId: "org-1",
    } as any)
    vi.mocked(prisma.orgNotificationChannel.update).mockResolvedValueOnce({
      ...mockChannel,
      enabled: false,
    } as any)
    const { PATCH } = await import("@/app/api/org/notification-channels/[id]/route")
    const res = await PATCH(
      new Request("http://localhost/api/org/notification-channels/channel-1", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { id: "channel-1" } },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(false)
  })
})

// ─── DELETE /api/org/notification-channels/[id] ──────────────────────────────

describe("DELETE /api/org/notification-channels/[id]", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { DELETE } = await import("@/app/api/org/notification-channels/[id]/route")
    const res = await DELETE(
      new Request("http://localhost/api/org/notification-channels/channel-1", { method: "DELETE" }),
      { params: { id: "channel-1" } },
    )
    expect(res.status).toBe(401)
  })

  it("returns 403 when user is a legal (only admin can delete)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(legalCtx)
    const { DELETE } = await import("@/app/api/org/notification-channels/[id]/route")
    const res = await DELETE(
      new Request("http://localhost/api/org/notification-channels/channel-1", { method: "DELETE" }),
      { params: { id: "channel-1" } },
    )
    expect(res.status).toBe(403)
  })

  it("returns 404 when channel belongs to a different org", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.orgNotificationChannel.findUnique).mockResolvedValueOnce({
      id: "channel-1",
      organizationId: "org-2",
    } as any)
    const { DELETE } = await import("@/app/api/org/notification-channels/[id]/route")
    const res = await DELETE(
      new Request("http://localhost/api/org/notification-channels/channel-1", { method: "DELETE" }),
      { params: { id: "channel-1" } },
    )
    expect(res.status).toBe(404)
  })

  it("returns 204 on successful deletion", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.orgNotificationChannel.findUnique).mockResolvedValueOnce({
      id: "channel-1",
      organizationId: "org-1",
    } as any)
    vi.mocked(prisma.orgNotificationChannel.delete).mockResolvedValueOnce({} as any)
    const { DELETE } = await import("@/app/api/org/notification-channels/[id]/route")
    const res = await DELETE(
      new Request("http://localhost/api/org/notification-channels/channel-1", { method: "DELETE" }),
      { params: { id: "channel-1" } },
    )
    expect(res.status).toBe(204)
    expect(prisma.orgNotificationChannel.delete).toHaveBeenCalledWith({
      where: { id: "channel-1" },
    })
  })
})

// ─── GET /api/org/webhooks ────────────────────────────────────────────────────

describe("GET /api/org/webhooks", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/org/webhooks/route")
    const res = await GET(new Request("http://localhost/api/org/webhooks"))
    expect(res.status).toBe(401)
  })

  it("returns 200 with empty array when no webhooks are configured", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.outboundWebhook.findMany).mockResolvedValueOnce([])
    const { GET } = await import("@/app/api/org/webhooks/route")
    const res = await GET(new Request("http://localhost/api/org/webhooks"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.webhooks).toEqual([])
  })

  it("returns 200 with urlPreview (not full URL) for each webhook", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.outboundWebhook.findMany).mockResolvedValueOnce([
      {
        id: "webhook-1",
        url: "enc:https://zapier.com/hooks/catch/123456/longpath",
        label: "Zapier",
        enabled: true,
        createdAt: new Date("2026-01-01"),
      },
    ] as any)
    const { GET } = await import("@/app/api/org/webhooks/route")
    const res = await GET(new Request("http://localhost/api/org/webhooks"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.webhooks).toHaveLength(1)
    const w = body.webhooks[0]
    // urlPreview is truncated to 30 chars + "..."
    expect(w).toHaveProperty("urlPreview")
    expect(w.urlPreview.length).toBeLessThanOrEqual(33) // 30 + "..."
    // Must not expose the full encrypted URL
    expect(w).not.toHaveProperty("url")
  })
})

// ─── POST /api/org/webhooks ───────────────────────────────────────────────────

describe("POST /api/org/webhooks", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/org/webhooks/route")
    const res = await POST(
      new Request("http://localhost/api/org/webhooks", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/hook", label: "My hook" }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 403 when user is a member (only admin)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    const { POST } = await import("@/app/api/org/webhooks/route")
    const res = await POST(
      new Request("http://localhost/api/org/webhooks", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/hook", label: "My hook" }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(403)
  })

  it("returns 422 when URL fails SSRF validation", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(validateWebhookUrl).mockRejectedValueOnce(new Error("Private or internal URLs are not allowed"))
    const { POST } = await import("@/app/api/org/webhooks/route")
    const res = await POST(
      new Request("http://localhost/api/org/webhooks", {
        method: "POST",
        body: JSON.stringify({ url: "http://10.0.0.1/hook", label: "Internal" }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain("not allowed")
  })

  it("returns 422 when the per-org limit (10) is reached", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.outboundWebhook.count).mockResolvedValueOnce(10)
    const { POST } = await import("@/app/api/org/webhooks/route")
    const res = await POST(
      new Request("http://localhost/api/org/webhooks", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/hook", label: "Extra" }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe("limit_reached")
  })

  it("returns 201 with id, label, and signingSecret (never encrypted URL)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.outboundWebhook.count).mockResolvedValueOnce(0)
    vi.mocked(prisma.outboundWebhook.create).mockResolvedValueOnce({
      id: "webhook-new",
      label: "My Webhook",
    } as any)
    const { POST } = await import("@/app/api/org/webhooks/route")
    const res = await POST(
      new Request("http://localhost/api/org/webhooks", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/hook", label: "My Webhook" }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({ id: "webhook-new", label: "My Webhook" })
    // signingSecret must be present in the creation response (shown once)
    expect(body).toHaveProperty("signingSecret")
    expect(typeof body.signingSecret).toBe("string")
    expect(body.signingSecret.length).toBeGreaterThan(0)
    // Must not expose the encrypted URL
    expect(body).not.toHaveProperty("url")
  })
})

// ─── DELETE /api/org/webhooks/[id] ───────────────────────────────────────────

describe("DELETE /api/org/webhooks/[id]", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { DELETE } = await import("@/app/api/org/webhooks/[id]/route")
    const res = await DELETE(
      new Request("http://localhost/api/org/webhooks/webhook-1", { method: "DELETE" }),
      { params: { id: "webhook-1" } },
    )
    expect(res.status).toBe(401)
  })

  it("returns 403 when user is a legal (only admin)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(legalCtx)
    const { DELETE } = await import("@/app/api/org/webhooks/[id]/route")
    const res = await DELETE(
      new Request("http://localhost/api/org/webhooks/webhook-1", { method: "DELETE" }),
      { params: { id: "webhook-1" } },
    )
    expect(res.status).toBe(403)
  })

  it("returns 404 when webhook belongs to a different org (org isolation)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.outboundWebhook.findUnique).mockResolvedValueOnce({
      id: "webhook-1",
      organizationId: "org-2",
    } as any)
    const { DELETE } = await import("@/app/api/org/webhooks/[id]/route")
    const res = await DELETE(
      new Request("http://localhost/api/org/webhooks/webhook-1", { method: "DELETE" }),
      { params: { id: "webhook-1" } },
    )
    expect(res.status).toBe(404)
  })

  it("returns 204 on successful deletion", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.outboundWebhook.findUnique).mockResolvedValueOnce({
      id: "webhook-1",
      organizationId: "org-1",
    } as any)
    vi.mocked(prisma.outboundWebhook.delete).mockResolvedValueOnce({} as any)
    const { DELETE } = await import("@/app/api/org/webhooks/[id]/route")
    const res = await DELETE(
      new Request("http://localhost/api/org/webhooks/webhook-1", { method: "DELETE" }),
      { params: { id: "webhook-1" } },
    )
    expect(res.status).toBe(204)
    expect(prisma.outboundWebhook.delete).toHaveBeenCalledWith({ where: { id: "webhook-1" } })
  })
})

// ─── GET /api/org/webhooks/[id]/deliveries ───────────────────────────────────

describe("GET /api/org/webhooks/[id]/deliveries", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/org/webhooks/[id]/deliveries/route")
    const res = await GET(
      new Request("http://localhost/api/org/webhooks/webhook-1/deliveries"),
      { params: { id: "webhook-1" } },
    )
    expect(res.status).toBe(401)
  })

  it("returns 403 when user is a member (only admin can see delivery logs)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    const { GET } = await import("@/app/api/org/webhooks/[id]/deliveries/route")
    const res = await GET(
      new Request("http://localhost/api/org/webhooks/webhook-1/deliveries"),
      { params: { id: "webhook-1" } },
    )
    expect(res.status).toBe(403)
  })

  it("returns 404 when webhook belongs to a different org", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.outboundWebhook.findUnique).mockResolvedValueOnce({
      id: "webhook-1",
      organizationId: "org-2",
    } as any)
    const { GET } = await import("@/app/api/org/webhooks/[id]/deliveries/route")
    const res = await GET(
      new Request("http://localhost/api/org/webhooks/webhook-1/deliveries"),
      { params: { id: "webhook-1" } },
    )
    expect(res.status).toBe(404)
  })

  it("returns 200 with deliveries and total count", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.outboundWebhook.findUnique).mockResolvedValueOnce({
      id: "webhook-1",
      organizationId: "org-1",
    } as any)
    const mockDelivery = {
      id: "delivery-1",
      eventName: "contract.signed",
      attempt: 1,
      httpStatus: 200,
      status: "success",
      durationMs: 120,
      deliveredAt: new Date("2026-01-01"),
      createdAt: new Date("2026-01-01"),
    }
    vi.mocked(prisma.webhookDeliveryLog.findMany).mockResolvedValueOnce([mockDelivery as any])
    vi.mocked(prisma.webhookDeliveryLog.count).mockResolvedValueOnce(1)
    const { GET } = await import("@/app/api/org/webhooks/[id]/deliveries/route")
    const res = await GET(
      new Request("http://localhost/api/org/webhooks/webhook-1/deliveries?page=1&limit=10"),
      { params: { id: "webhook-1" } },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deliveries).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(body.deliveries[0]).toMatchObject({
      eventName: "contract.signed",
      httpStatus: 200,
      status: "success",
    })
  })

  it("returns 200 with empty deliveries for a webhook with no history", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.outboundWebhook.findUnique).mockResolvedValueOnce({
      id: "webhook-1",
      organizationId: "org-1",
    } as any)
    vi.mocked(prisma.webhookDeliveryLog.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.webhookDeliveryLog.count).mockResolvedValueOnce(0)
    const { GET } = await import("@/app/api/org/webhooks/[id]/deliveries/route")
    const res = await GET(
      new Request("http://localhost/api/org/webhooks/webhook-1/deliveries"),
      { params: { id: "webhook-1" } },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deliveries).toEqual([])
    expect(body.total).toBe(0)
  })
})

// ─── GET /api/user/notification-preferences ──────────────────────────────────

describe("GET /api/user/notification-preferences", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/user/notification-preferences/route")
    const res = await GET(new Request("http://localhost/api/user/notification-preferences"))
    expect(res.status).toBe(401)
  })

  it("returns 200 with full preference set (using defaults for unset events)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    // Only one event stored in DB — others will use defaults
    vi.mocked(prisma.userNotificationPreference.findMany).mockResolvedValueOnce([
      { eventName: "contract.signed", emailEnabled: false },
    ] as any)
    const { GET } = await import("@/app/api/user/notification-preferences/route")
    const res = await GET(new Request("http://localhost/api/user/notification-preferences"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.preferences).toBeDefined()
    expect(Array.isArray(body.preferences)).toBe(true)
    // Should have an entry for every event
    expect(body.preferences.length).toBeGreaterThan(0)
    // contract.signed must be false (overriding the default true)
    const signed = body.preferences.find((p: { eventName: string }) => p.eventName === "contract.signed")
    expect(signed).toBeDefined()
    expect(signed.emailEnabled).toBe(false)
  })

  it("returns 200 with all-default preferences when no rows exist in DB", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    vi.mocked(prisma.userNotificationPreference.findMany).mockResolvedValueOnce([])
    const { GET } = await import("@/app/api/user/notification-preferences/route")
    const res = await GET(new Request("http://localhost/api/user/notification-preferences"))
    expect(res.status).toBe(200)
    const body = await res.json()
    // approval.requested has DEFAULT_EMAIL_ENABLED = true
    const approvalPref = body.preferences.find(
      (p: { eventName: string }) => p.eventName === "approval.requested",
    )
    expect(approvalPref?.emailEnabled).toBe(true)
  })
})

// ─── PUT /api/user/notification-preferences ──────────────────────────────────

describe("PUT /api/user/notification-preferences", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { PUT } = await import("@/app/api/user/notification-preferences/route")
    const res = await PUT(
      new Request("http://localhost/api/user/notification-preferences", {
        method: "PUT",
        body: JSON.stringify({ preferences: [{ eventName: "contract.signed", emailEnabled: false }] }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 when request body is not valid JSON", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { PUT } = await import("@/app/api/user/notification-preferences/route")
    const res = await PUT(
      new Request("http://localhost/api/user/notification-preferences", {
        method: "PUT",
        body: "not-json",
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 422 when preferences array is missing", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { PUT } = await import("@/app/api/user/notification-preferences/route")
    const res = await PUT(
      new Request("http://localhost/api/user/notification-preferences", {
        method: "PUT",
        body: JSON.stringify({ settings: [] }), // wrong key
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(422)
  })

  it("silently ignores unknown eventNames and returns 200 with updated prefs", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    // $transaction returns results of the two operations
    vi.mocked(prisma.$transaction).mockResolvedValueOnce([{ count: 0 }, { count: 1 }] as any)
    vi.mocked(prisma.userNotificationPreference.findMany).mockResolvedValueOnce([
      { eventName: "contract.signed", emailEnabled: false },
    ] as any)
    const { PUT } = await import("@/app/api/user/notification-preferences/route")
    const res = await PUT(
      new Request("http://localhost/api/user/notification-preferences", {
        method: "PUT",
        body: JSON.stringify({
          preferences: [
            { eventName: "contract.signed", emailEnabled: false },
            { eventName: "totally.unknown.event", emailEnabled: true }, // should be filtered out
          ],
        }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.preferences).toBeDefined()
    expect(Array.isArray(body.preferences)).toBe(true)
  })
})

// ─── GET /api/user/unsubscribe ────────────────────────────────────────────────

describe("GET /api/user/unsubscribe", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 400 when token query param is missing", async () => {
    const { GET } = await import("@/app/api/user/unsubscribe/route")
    const res = await GET(new Request("http://localhost/api/user/unsubscribe"))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("invalid_token")
  })

  it("returns 400 when token is invalid or expired", async () => {
    vi.mocked(verifyUnsubscribeToken).mockReturnValueOnce(null)
    const { GET } = await import("@/app/api/user/unsubscribe/route")
    const res = await GET(
      new Request("http://localhost/api/user/unsubscribe?token=bad-token"),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("invalid_token")
  })

  it("returns 400 when user is no longer a member of the org", async () => {
    vi.mocked(verifyUnsubscribeToken).mockReturnValueOnce({
      userId: "user-gone",
      orgId: "org-1",
      eventName: "contract.signed",
    })
    vi.mocked(prisma.member.findUnique).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/user/unsubscribe/route")
    const res = await GET(
      new Request("http://localhost/api/user/unsubscribe?token=valid-but-user-gone"),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("invalid_token")
  })

  it("upserts the preference and redirects to notification settings page on success", async () => {
    vi.mocked(verifyUnsubscribeToken).mockReturnValueOnce({
      userId: "user-admin",
      orgId: "org-1",
      eventName: "contract.signed",
    })
    vi.mocked(prisma.member.findUnique).mockResolvedValueOnce({ userId: "user-admin" } as any)
    vi.mocked(prisma.userNotificationPreference.upsert).mockResolvedValueOnce({} as any)
    const { GET } = await import("@/app/api/user/unsubscribe/route")
    const res = await GET(
      new Request("http://localhost/api/user/unsubscribe?token=valid-token"),
    )
    // NextResponse.redirect returns 307/308 or 302 depending on Next.js version
    expect([302, 307, 308]).toContain(res.status)
    const location = res.headers.get("location") ?? res.headers.get("Location") ?? ""
    expect(location).toContain("unsubscribed=1")
    expect(location).toContain("contract.signed")
    expect(prisma.userNotificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { emailEnabled: false },
        create: expect.objectContaining({ emailEnabled: false }),
      }),
    )
  })
})

// ─── GET /api/notifications ───────────────────────────────────────────────────

describe("GET /api/notifications", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/notifications/route")
    const res = await GET(new Request("http://localhost/api/notifications"))
    expect(res.status).toBe(401)
  })

  it("returns 200 with notifications and unreadCount", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const mockNotif = {
      id: "notif-1",
      contractId: "contract-1",
      eventName: "contract.signed",
      title: "Contract Signed",
      body: "Your contract has been signed",
      read: false,
      readAt: null,
      createdAt: new Date("2026-01-01"),
    }
    vi.mocked(prisma.notification.findMany).mockResolvedValueOnce([mockNotif as any])
    vi.mocked(prisma.notification.count).mockResolvedValueOnce(1)
    const { GET } = await import("@/app/api/notifications/route")
    const res = await GET(new Request("http://localhost/api/notifications"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.notifications).toHaveLength(1)
    expect(body.unreadCount).toBe(1)
    expect(body.notifications[0]).toMatchObject({
      eventName: "contract.signed",
      read: false,
    })
  })

  it("includes org.invited notifications regardless of current org", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx) // organizationId = org-1
    vi.mocked(prisma.notification.findMany).mockResolvedValueOnce([
      {
        id: "notif-invite",
        contractId: null,
        eventName: "org.invited",
        title: "You were invited",
        body: "Someone invited you to another org",
        read: false,
        readAt: null,
        createdAt: new Date("2026-01-01"),
      },
    ] as any)
    vi.mocked(prisma.notification.count).mockResolvedValueOnce(1)
    const { GET } = await import("@/app/api/notifications/route")
    const res = await GET(new Request("http://localhost/api/notifications"))
    expect(res.status).toBe(200)
    const body = await res.json()
    // The OR pattern must query both org-scoped and org.invited events
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-admin",
          OR: expect.arrayContaining([
            { organizationId: "org-1" },
            { eventName: "org.invited" },
          ]),
        }),
      }),
    )
  })

  it("returns 200 with empty notifications when none exist", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    vi.mocked(prisma.notification.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.notification.count).mockResolvedValueOnce(0)
    const { GET } = await import("@/app/api/notifications/route")
    const res = await GET(new Request("http://localhost/api/notifications"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.notifications).toEqual([])
    expect(body.unreadCount).toBe(0)
  })
})

// ─── POST /api/notifications/read-all ────────────────────────────────────────

describe("POST /api/notifications/read-all", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/notifications/read-all/route")
    const res = await POST(
      new Request("http://localhost/api/notifications/read-all", { method: "POST" }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 200 and marks all unread notifications as read", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.notification.updateMany).mockResolvedValueOnce({ count: 3 } as any)
    const { POST } = await import("@/app/api/notifications/read-all/route")
    const res = await POST(
      new Request("http://localhost/api/notifications/read-all", { method: "POST" }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-admin",
          read: false,
          OR: expect.arrayContaining([
            { organizationId: "org-1" },
            { eventName: "org.invited" },
          ]),
        }),
        data: expect.objectContaining({ read: true }),
      }),
    )
  })

  it("returns 200 with ok=true even when there are no unread notifications", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(viewerCtx)
    vi.mocked(prisma.notification.updateMany).mockResolvedValueOnce({ count: 0 } as any)
    const { POST } = await import("@/app/api/notifications/read-all/route")
    const res = await POST(
      new Request("http://localhost/api/notifications/read-all", { method: "POST" }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})

import { describe, it, expect, vi, beforeEach } from "vitest"
import { requestContext } from "@/lib/context"

const mockAdminCtx = {
  userId: "user-1",
  organizationId: "org-1",
  role: "admin",
  source: "session" as const,
  requestId: "test-request-id",
}

const mockViewerCtx = {
  userId: "user-2",
  organizationId: "org-1",
  role: "viewer",
  source: "session" as const,
  requestId: "test-request-id",
}

vi.mock("@/lib/auth/middleware", () => ({
  resolveAuth: vi.fn().mockResolvedValue(mockAdminCtx),
  requireWriteScope: vi.fn(() => null),
}))

// Mock alertsCheckQueue so no real Redis calls happen
vi.mock("@/lib/jobs/queues", () => ({
  contractExtractQueue:  { add: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
  contractAiExtractQueue:{ add: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
  alertsCheckQueue:      { add: vi.fn().mockResolvedValue({ id: "job-42" }) },
}))

describe("POST /api/alerts — manual trigger", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)

    const { POST } = await import("@/app/api/alerts/route")
    const res = await POST(new Request("http://localhost/api/alerts", { method: "POST" }))

    expect(res.status).toBe(401)
  })

  it("returns 403 when caller is viewer (below admin)", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValueOnce(mockViewerCtx)

    const { POST } = await import("@/app/api/alerts/route")
    const res = await requestContext.run(mockViewerCtx, () =>
      POST(new Request("http://localhost/api/alerts", { method: "POST" })),
    )

    expect(res.status).toBe(403)
  })

  it("enqueues a BullMQ job and returns 202 with jobId for admin", async () => {
    const { alertsCheckQueue } = await import("@/lib/jobs/queues")

    const { POST } = await import("@/app/api/alerts/route")
    const res = await requestContext.run(mockAdminCtx, () =>
      POST(new Request("http://localhost/api/alerts", { method: "POST" })),
    )

    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.queued).toBe(true)
    expect(body.jobId).toBe("job-42")

    expect(alertsCheckQueue.add).toHaveBeenCalledWith(
      "manual-check",
      expect.objectContaining({ triggeredAt: expect.any(String) }),
    )
  })

  it("owner role also passes the admin gate", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValueOnce({
      ...mockAdminCtx,
      role: "owner",
    })

    const { POST } = await import("@/app/api/alerts/route")
    const res = await requestContext.run({ ...mockAdminCtx, role: "owner" }, () =>
      POST(new Request("http://localhost/api/alerts", { method: "POST" })),
    )

    expect(res.status).toBe(202)
  })

  it("member role is rejected", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValueOnce({ ...mockAdminCtx, role: "member" })

    const { POST } = await import("@/app/api/alerts/route")
    const res = await requestContext.run({ ...mockAdminCtx, role: "member" }, () =>
      POST(new Request("http://localhost/api/alerts", { method: "POST" })),
    )

    expect(res.status).toBe(403)
  })
})

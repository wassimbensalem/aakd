/**
 * Import Integration Tests
 *
 * Covers all import-related API routes:
 *  - POST   /api/import/csv                — Start a CSV import job
 *  - GET    /api/import/gdrive/connect     — Initiate Google Drive OAuth
 *  - DELETE /api/import/gdrive/connect     — Disconnect Google Drive
 *
 * No real Google OAuth credentials needed — the connect endpoint is either
 * 503 (unconfigured) or 302 (redirect). The CSV route is fully exercised
 * via mocked Prisma and queue primitives.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { prisma } from "@/lib/db/client"

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/middleware", () => ({
  resolveAuth: vi.fn(),
  requireWriteScope: vi.fn(() => null),
}))

vi.mock("@/lib/db/activity", () => ({
  writeActivity: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/types/import-queue", () => ({
  enqueueImportProcess: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/storage", () => ({
  storage: {
    upload: vi.fn().mockResolvedValue("imports/org-1/job-abc/source.zip"),
    getSignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.example.com/source.zip"),
    storageKey: vi.fn((_org: string, _id: string, filename: string) => filename),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { enqueueImportProcess } from "@/lib/types/import-queue"

/** See crm.test.ts for explanation of why mockReset() is needed. */
function resetMockQueues() {
  vi.mocked(resolveAuth).mockReset()
  vi.mocked(requireWriteScope).mockReturnValue(null)
  vi.mocked(enqueueImportProcess).mockResolvedValue(undefined)
}

const adminCtx = {
  userId: "user-admin",
  organizationId: "org-1",
  role: "admin",
  source: "session" as const,
  requestId: "req-test",
}

const legalCtx = { ...adminCtx, role: "legal" }
const memberCtx = { ...adminCtx, role: "member" }
const viewerCtx = { ...adminCtx, role: "viewer" }

// ─── POST /api/import/csv ─────────────────────────────────────────────────────

describe("POST /api/import/csv", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/import/csv/route")
    const res = await POST(
      new Request("http://localhost/api/import/csv", {
        method: "POST",
        body: JSON.stringify({ storageKey: "imports/org-1/file.csv", mapping: { col1: "title" }, totalRows: 5 }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 403 when user is a viewer (below member)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(viewerCtx)
    const { POST } = await import("@/app/api/import/csv/route")
    const res = await POST(
      new Request("http://localhost/api/import/csv", {
        method: "POST",
        body: JSON.stringify({ storageKey: "imports/org-1/file.csv", mapping: { col1: "title" }, totalRows: 5 }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(403)
  })

  it("returns 422 when request body is invalid JSON", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { POST } = await import("@/app/api/import/csv/route")
    const res = await POST(
      new Request("http://localhost/api/import/csv", {
        method: "POST",
        body: "not-json",
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 422 when storageKey field is missing", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { POST } = await import("@/app/api/import/csv/route")
    const res = await POST(
      new Request("http://localhost/api/import/csv", {
        method: "POST",
        body: JSON.stringify({ mapping: { col1: "title" }, totalRows: 5 }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(422)
  })

  it("returns 422 when storageKey belongs to a different org (security: prefix check)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx) // org-1
    const { POST } = await import("@/app/api/import/csv/route")
    const res = await POST(
      new Request("http://localhost/api/import/csv", {
        method: "POST",
        body: JSON.stringify({
          // Key belongs to org-2 — should be rejected even if the user has a valid session
          storageKey: "imports/org-2/attacker-file.csv",
          mapping: { col1: "title" },
          totalRows: 3,
        }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe("invalid_storage_key")
  })

  it("returns 422 when no column is mapped to `title`", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { POST } = await import("@/app/api/import/csv/route")
    const res = await POST(
      new Request("http://localhost/api/import/csv", {
        method: "POST",
        body: JSON.stringify({
          storageKey: "imports/org-1/file.csv",
          // mapping has counterpartyName but not title — must be rejected
          mapping: { col1: "counterpartyName", col2: "value" },
          totalRows: 5,
        }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe("title_not_mapped")
  })

  it("returns 201 and enqueues an import job on success", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.importJob.create).mockResolvedValueOnce({
      id: "job-abc",
      totalRows: 10,
    } as any)
    const { POST } = await import("@/app/api/import/csv/route")
    const res = await POST(
      new Request("http://localhost/api/import/csv", {
        method: "POST",
        body: JSON.stringify({
          storageKey: "imports/org-1/file.csv",
          mapping: { col1: "title", col2: "counterpartyName" },
          totalRows: 10,
        }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.jobId).toBe("job-abc")
    expect(body.totalRows).toBe(10)
    expect(enqueueImportProcess).toHaveBeenCalledWith(
      expect.objectContaining({ importJobId: "job-abc", organizationId: "org-1" }),
    )
  })

  it("still returns 201 even when the queue enqueue fails (job stays in PENDING for retry)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.importJob.create).mockResolvedValueOnce({
      id: "job-xyz",
      totalRows: 3,
    } as any)
    vi.mocked(enqueueImportProcess).mockRejectedValueOnce(new Error("Redis unavailable"))
    const { POST } = await import("@/app/api/import/csv/route")
    const res = await POST(
      new Request("http://localhost/api/import/csv", {
        method: "POST",
        body: JSON.stringify({
          storageKey: "imports/org-1/file.csv",
          mapping: { title: "title" },
          totalRows: 3,
        }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    // Must still return 201 — the job is recorded and can be retried from the UI
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.jobId).toBe("job-xyz")
  })

  it("persists the column mapping as JSON in the ImportJob row", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.importJob.create).mockResolvedValueOnce({ id: "job-1", totalRows: 2 } as any)
    const { POST } = await import("@/app/api/import/csv/route")
    await POST(
      new Request("http://localhost/api/import/csv", {
        method: "POST",
        body: JSON.stringify({
          storageKey: "imports/org-1/data.csv",
          mapping: { A: "title", B: "counterpartyName", C: null },
          totalRows: 2,
        }),
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(prisma.importJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: "CSV",
          status: "PENDING",
          organizationId: "org-1",
          mappingJson: JSON.stringify({ A: "title", B: "counterpartyName", C: null }),
        }),
      }),
    )
  })
})

// ─── GET /api/import/gdrive/connect ──────────────────────────────────────────

describe("GET /api/import/gdrive/connect", () => {
  const origGoogleClientId = process.env.GOOGLE_CLIENT_ID

  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })
  afterEach(() => {
    // Restore env var after each test that modifies it
    if (origGoogleClientId === undefined) {
      delete process.env.GOOGLE_CLIENT_ID
    } else {
      process.env.GOOGLE_CLIENT_ID = origGoogleClientId
    }
  })

  it("returns 503 when GOOGLE_CLIENT_ID is not configured", async () => {
    delete process.env.GOOGLE_CLIENT_ID
    // Do NOT mock resolveAuth here — the route returns 503 before calling it,
    // so queuing a mock would leave it unconsumed and bleed into the next test.
    const { GET } = await import("@/app/api/import/gdrive/connect/route")
    const res = await GET(new Request("http://localhost/api/import/gdrive/connect"))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe("google_drive_not_configured")
  })

  it("returns 401 when unauthenticated (even if credentials are set)", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id"
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/import/gdrive/connect/route")
    const res = await GET(new Request("http://localhost/api/import/gdrive/connect"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when user has legal role (below admin — Google Drive requires admin)", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id"
    vi.mocked(resolveAuth).mockResolvedValueOnce(legalCtx)
    const { GET } = await import("@/app/api/import/gdrive/connect/route")
    const res = await GET(new Request("http://localhost/api/import/gdrive/connect"))
    expect(res.status).toBe(403)
  })

  it("returns 302 redirect to Google OAuth with drive.readonly scope", async () => {
    process.env.GOOGLE_CLIENT_ID = "google-client-123"
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { GET } = await import("@/app/api/import/gdrive/connect/route")
    const res = await GET(new Request("http://localhost/api/import/gdrive/connect"))
    expect(res.status).toBe(302)
    const location = res.headers.get("Location") ?? ""
    expect(location).toContain("accounts.google.com/o/oauth2/v2/auth")
    expect(location).toContain("drive.readonly")
    expect(location).toContain("google-client-123")
    expect(location).toContain("access_type=offline")
  })

  it("sets a gdrive_oauth_state cookie for CSRF protection", async () => {
    process.env.GOOGLE_CLIENT_ID = "google-client-123"
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { GET } = await import("@/app/api/import/gdrive/connect/route")
    const res = await GET(new Request("http://localhost/api/import/gdrive/connect"))
    const cookie = res.headers.get("Set-Cookie") ?? ""
    expect(cookie).toContain("gdrive_oauth_state=")
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("SameSite=Lax")
  })
})

// ─── DELETE /api/import/gdrive/connect ───────────────────────────────────────

describe("DELETE /api/import/gdrive/connect", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { DELETE } = await import("@/app/api/import/gdrive/connect/route")
    const res = await DELETE(
      new Request("http://localhost/api/import/gdrive/connect", { method: "DELETE" }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 403 when user has legal role (only admin can disconnect Google Drive)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(legalCtx)
    const { DELETE } = await import("@/app/api/import/gdrive/connect/route")
    const res = await DELETE(
      new Request("http://localhost/api/import/gdrive/connect", { method: "DELETE" }),
    )
    expect(res.status).toBe(403)
  })

  it("returns 404 when no Google Drive integration is connected for this org", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.googleDriveIntegration.findUnique).mockResolvedValueOnce(null)
    const { DELETE } = await import("@/app/api/import/gdrive/connect/route")
    const res = await DELETE(
      new Request("http://localhost/api/import/gdrive/connect", { method: "DELETE" }),
    )
    expect(res.status).toBe(404)
  })

  it("returns 204 and deletes the integration on success", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.googleDriveIntegration.findUnique).mockResolvedValueOnce({
      id: "gdrive-integration-1",
      organizationId: "org-1",
    } as any)
    vi.mocked(prisma.googleDriveIntegration.delete).mockResolvedValueOnce({} as any)
    const { DELETE } = await import("@/app/api/import/gdrive/connect/route")
    const res = await DELETE(
      new Request("http://localhost/api/import/gdrive/connect", { method: "DELETE" }),
    )
    expect(res.status).toBe(204)
    expect(prisma.googleDriveIntegration.delete).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
    })
    // State cookie must be cleared
    const cookie = res.headers.get("Set-Cookie") ?? ""
    expect(cookie).toContain("gdrive_oauth_state=;")
    expect(cookie).toContain("Max-Age=0")
  })
})

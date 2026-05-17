/**
 * Import Extended Integration Tests
 *
 * Covers the routes NOT covered by import.test.ts:
 *  - POST  /api/import/csv/preview        — CSV file upload + column suggestion
 *  - POST  /api/import/pandadoc           — PandaDoc ZIP upload
 *  - POST  /api/import/batch              — Batch PDF/DOCX upload (ZIP or multi-file)
 *  - GET   /api/import/gdrive/files       — List Google Drive files
 *  - GET   /api/import/gdrive/callback    — OAuth callback (stores integration)
 *  - GET   /api/import/[jobId]            — Job status + rows
 *  - POST  /api/import/[jobId]/retry      — Retry failed rows
 *  - GET   /api/import/[jobId]/error-report — Redirect to signed error CSV
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
    upload: vi.fn().mockResolvedValue("imports/org-1/preview-id/source.csv"),
    getSignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.example.com/errors.csv"),
    storageKey: vi.fn((_org: string, _id: string, filename: string) => filename),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("@/lib/types/import-helpers", () => ({
  parseCsv: vi.fn(),
  suggestColumnMapping: vi.fn().mockReturnValue({ Title: "title" }),
  isZipBuffer: vi.fn(),
  sanitizeFilename: vi.fn((f: string) => f.replace(/[^a-zA-Z0-9._-]/g, "_")),
}))

vi.mock("@/lib/import/gdrive-client", () => ({
  listDriveFiles: vi.fn(),
}))

// Prevent notifications/crypto from throwing due to missing env
vi.mock("@/lib/notifications/crypto", () => ({
  encrypt: vi.fn((s: string) => `enc:${s}`),
  decrypt: vi.fn((s: string) => s.replace(/^enc:/, "")),
  __resetKeyCacheForTests: vi.fn(),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { enqueueImportProcess } from "@/lib/types/import-queue"
import { storage } from "@/lib/storage"
import { parseCsv, isZipBuffer } from "@/lib/types/import-helpers"
import { listDriveFiles } from "@/lib/import/gdrive-client"

function resetMockQueues() {
  vi.mocked(resolveAuth).mockReset()
  vi.mocked(requireWriteScope).mockReturnValue(null)
  vi.mocked(enqueueImportProcess).mockResolvedValue(undefined)
  vi.mocked(storage.upload).mockResolvedValue("imports/org-1/job/source.zip")
  vi.mocked(storage.getSignedDownloadUrl).mockResolvedValue("https://s3.example.com/errors.csv")
  vi.mocked(listDriveFiles).mockReset()
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

/** Build a minimal valid CSV File object for testing. */
function makeCsvFile(content = "Title,Counterparty\nAcme NDA,Acme Corp", name = "test.csv"): File {
  return new File([content], name, { type: "text/csv" })
}

/** Build a minimal ZIP-magic-bytes buffer. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Array(20).fill(0x00)])

function makeZipFile(size = ZIP_MAGIC.length, name = "export.zip"): File {
  const buf = Buffer.alloc(size, 0x00)
  buf.set([0x50, 0x4b, 0x03, 0x04])
  return new File([buf], name, { type: "application/zip" })
}

function makePdfFile(name = "contract.pdf"): File {
  const buf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF-
  return new File([buf], name, { type: "application/pdf" })
}

/**
 * Build a Request whose formData() resolves to the provided FormData.
 *
 * jsdom's FormData serialization is not compatible with Node/undici's
 * multipart boundary parser — calling req.formData() on a jsdom-constructed
 * Request throws. We work around this by creating a plain Request and
 * replacing formData() with a function that returns our controlled FormData.
 */
function makeFormRequest(url: string, fd: FormData): Request {
  const req = new Request(url, { method: "POST", body: "" })
  Object.defineProperty(req, "formData", {
    value: () => Promise.resolve(fd),
    writable: true,
  })
  return req
}

// ─── POST /api/import/csv/preview ────────────────────────────────────────────

describe("POST /api/import/csv/preview", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/import/csv/preview/route")
    const fd = new FormData()
    fd.append("file", makeCsvFile())
    const res = await POST(makeFormRequest("http://localhost/api/import/csv/preview", fd))
    expect(res.status).toBe(401)
  })

  it("returns 400 when no file is attached", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { POST } = await import("@/app/api/import/csv/preview/route")
    const fd = new FormData()
    // No file appended
    const res = await POST(makeFormRequest("http://localhost/api/import/csv/preview", fd))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("no_file")
  })

  it("returns 422 when uploaded file is not a CSV", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { POST } = await import("@/app/api/import/csv/preview/route")
    const fd = new FormData()
    fd.append("file", new File(["data"], "doc.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }))
    const res = await POST(makeFormRequest("http://localhost/api/import/csv/preview", fd))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe("invalid_csv")
  })

  it("returns 422 when parseCsv returns no rows", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(parseCsv).mockReturnValueOnce([[""]])
    const { POST } = await import("@/app/api/import/csv/preview/route")
    const fd = new FormData()
    fd.append("file", makeCsvFile(""))
    const res = await POST(makeFormRequest("http://localhost/api/import/csv/preview", fd))
    expect(res.status).toBe(422)
  })

  it("returns 422 when CSV has too many data rows", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    // parseCsv returns header + 1001 data rows
    const rows = [["Title", "Counterparty"], ...Array(1001).fill(["Row", "Data"])]
    vi.mocked(parseCsv).mockReturnValueOnce(rows)
    const { POST } = await import("@/app/api/import/csv/preview/route")
    const fd = new FormData()
    fd.append("file", makeCsvFile())
    const res = await POST(makeFormRequest("http://localhost/api/import/csv/preview", fd))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe("csv_too_large")
  })

  it("returns 502 when storage upload fails", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(parseCsv).mockReturnValueOnce([["Title", "Counterparty"], ["Acme NDA", "Acme Corp"]])
    vi.mocked(storage.upload).mockRejectedValueOnce(new Error("S3 error"))
    const { POST } = await import("@/app/api/import/csv/preview/route")
    const fd = new FormData()
    fd.append("file", makeCsvFile())
    const res = await POST(makeFormRequest("http://localhost/api/import/csv/preview", fd))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe("storage_failed")
  })

  it("returns 200 with headers, suggestedMapping, previewRows, storageKey on success", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(parseCsv).mockReturnValueOnce([
      ["Title", "Counterparty", "Value"],
      ["Acme NDA", "Acme Corp", "50000"],
      ["Beta MSA", "Beta Inc", "100000"],
    ])
    vi.mocked(storage.upload).mockResolvedValueOnce("imports/org-1/previews/abc/source.csv")
    const { POST } = await import("@/app/api/import/csv/preview/route")
    const fd = new FormData()
    fd.append("file", makeCsvFile())
    const res = await POST(makeFormRequest("http://localhost/api/import/csv/preview", fd))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty("previewId")
    expect(body).toHaveProperty("headers")
    expect(body.headers).toContain("Title")
    expect(body).toHaveProperty("suggestedMapping")
    expect(body).toHaveProperty("previewRows")
    expect(body).toHaveProperty("totalRows", 2)
    expect(body).toHaveProperty("storageKey")
    expect(body.storageKey).toContain("org-1")
  })
})

// ─── POST /api/import/pandadoc ────────────────────────────────────────────────

describe("POST /api/import/pandadoc", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/import/pandadoc/route")
    const fd = new FormData()
    fd.append("file", makeZipFile())
    const res = await POST(makeFormRequest("http://localhost/api/import/pandadoc", fd))
    expect(res.status).toBe(401)
  })

  it("returns 403 when user is a viewer", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(viewerCtx)
    const { POST } = await import("@/app/api/import/pandadoc/route")
    const fd = new FormData()
    fd.append("file", makeZipFile())
    const res = await POST(makeFormRequest("http://localhost/api/import/pandadoc", fd))
    expect(res.status).toBe(403)
  })

  it("returns 400 when no file is attached", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    const { POST } = await import("@/app/api/import/pandadoc/route")
    const fd = new FormData()
    const res = await POST(makeFormRequest("http://localhost/api/import/pandadoc", fd))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("no_file")
  })

  it("returns 422 when uploaded file is not a valid ZIP (magic bytes check)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    vi.mocked(isZipBuffer).mockReturnValueOnce(false)
    const { POST } = await import("@/app/api/import/pandadoc/route")
    const fd = new FormData()
    // A fake "zip" that fails the magic-bytes check
    fd.append("file", new File([Buffer.from([0x00, 0x01, 0x02])], "not-really.zip", { type: "application/zip" }))
    const res = await POST(makeFormRequest("http://localhost/api/import/pandadoc", fd))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe("not_a_zip")
  })

  it("returns 502 when storage upload fails", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    vi.mocked(isZipBuffer).mockReturnValueOnce(true)
    vi.mocked(storage.upload).mockRejectedValueOnce(new Error("S3 unavailable"))
    const { POST } = await import("@/app/api/import/pandadoc/route")
    const fd = new FormData()
    fd.append("file", makeZipFile())
    const res = await POST(makeFormRequest("http://localhost/api/import/pandadoc", fd))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe("storage_failed")
  })

  it("returns 201 and creates an ImportJob on success", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    vi.mocked(isZipBuffer).mockReturnValueOnce(true)
    vi.mocked(storage.upload).mockResolvedValueOnce("imports/org-1/job-pd/source.zip")
    vi.mocked(prisma.importJob.create).mockResolvedValueOnce({
      id: "job-pd",
      totalRows: 0,
    } as any)
    const { POST } = await import("@/app/api/import/pandadoc/route")
    const fd = new FormData()
    fd.append("file", makeZipFile())
    const res = await POST(makeFormRequest("http://localhost/api/import/pandadoc", fd))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.jobId).toBe("job-pd")
    expect(enqueueImportProcess).toHaveBeenCalledWith(
      expect.objectContaining({ importJobId: "job-pd", organizationId: "org-1" }),
    )
  })

  it("still returns 201 when queue enqueue fails", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    vi.mocked(isZipBuffer).mockReturnValueOnce(true)
    vi.mocked(storage.upload).mockResolvedValueOnce("imports/org-1/job-pd2/source.zip")
    vi.mocked(prisma.importJob.create).mockResolvedValueOnce({ id: "job-pd2", totalRows: 0 } as any)
    vi.mocked(enqueueImportProcess).mockRejectedValueOnce(new Error("Redis down"))
    const { POST } = await import("@/app/api/import/pandadoc/route")
    const fd = new FormData()
    fd.append("file", makeZipFile())
    const res = await POST(makeFormRequest("http://localhost/api/import/pandadoc", fd))
    expect(res.status).toBe(201)
  })
})

// ─── POST /api/import/batch ───────────────────────────────────────────────────

describe("POST /api/import/batch", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/import/batch/route")
    const fd = new FormData()
    fd.append("file", makeZipFile())
    const res = await POST(makeFormRequest("http://localhost/api/import/batch", fd))
    expect(res.status).toBe(401)
  })

  it("returns 403 when user is a viewer", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(viewerCtx)
    const { POST } = await import("@/app/api/import/batch/route")
    const fd = new FormData()
    fd.append("file", makeZipFile())
    const res = await POST(makeFormRequest("http://localhost/api/import/batch", fd))
    expect(res.status).toBe(403)
  })

  it("returns 400 when neither file nor files[] is provided", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    const { POST } = await import("@/app/api/import/batch/route")
    const fd = new FormData()
    const res = await POST(makeFormRequest("http://localhost/api/import/batch", fd))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("no_files")
  })

  it("returns 422 when ZIP file fails magic-bytes check", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    vi.mocked(isZipBuffer).mockReturnValueOnce(false)
    const { POST } = await import("@/app/api/import/batch/route")
    const fd = new FormData()
    fd.append("file", new File([Buffer.from([0x00, 0x01])], "fake.zip", { type: "application/zip" }))
    const res = await POST(makeFormRequest("http://localhost/api/import/batch", fd))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe("not_a_zip")
  })

  it("returns 422 when too many individual files are provided", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    const { POST } = await import("@/app/api/import/batch/route")
    const fd = new FormData()
    // 51 files (above MAX_FILES = 50)
    for (let i = 0; i < 51; i++) {
      fd.append("files[]", makePdfFile(`contract${i}.pdf`))
    }
    const res = await POST(makeFormRequest("http://localhost/api/import/batch", fd))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe("too_many_files")
  })

  it("returns 502 when storage upload fails for ZIP", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    vi.mocked(isZipBuffer).mockReturnValueOnce(true)
    vi.mocked(storage.upload).mockRejectedValueOnce(new Error("S3 error"))
    const { POST } = await import("@/app/api/import/batch/route")
    const fd = new FormData()
    fd.append("file", makeZipFile())
    const res = await POST(makeFormRequest("http://localhost/api/import/batch", fd))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe("storage_failed")
  })

  it("returns 201 for ZIP path and enqueues job", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    vi.mocked(isZipBuffer).mockReturnValueOnce(true)
    vi.mocked(storage.upload).mockResolvedValueOnce("imports/org-1/job-batch/source.zip")
    vi.mocked(prisma.importJob.create).mockResolvedValueOnce({ id: "job-batch", totalRows: 0 } as any)
    const { POST } = await import("@/app/api/import/batch/route")
    const fd = new FormData()
    fd.append("file", makeZipFile())
    const res = await POST(makeFormRequest("http://localhost/api/import/batch", fd))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.jobId).toBe("job-batch")
  })

  it("returns 201 for multi-file path and enqueues job", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(memberCtx)
    vi.mocked(storage.upload)
      .mockResolvedValueOnce("imports/org-1/job-mf/files/0_contract1.pdf")
      .mockResolvedValueOnce("imports/org-1/job-mf/files/1_contract2.pdf")
      .mockResolvedValueOnce("imports/org-1/job-mf/manifest.json") // manifest
    vi.mocked(prisma.importJob.create).mockResolvedValueOnce({ id: "job-mf", totalRows: 2 } as any)
    const { POST } = await import("@/app/api/import/batch/route")
    const fd = new FormData()
    fd.append("files[]", makePdfFile("contract1.pdf"))
    fd.append("files[]", makePdfFile("contract2.pdf"))
    const res = await POST(makeFormRequest("http://localhost/api/import/batch", fd))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.jobId).toBe("job-mf")
    expect(body.totalRows).toBe(2)
  })
})

// ─── GET /api/import/gdrive/files ─────────────────────────────────────────────

describe("GET /api/import/gdrive/files", () => {
  const origGoogleClientId = process.env.GOOGLE_CLIENT_ID
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })
  afterEach(() => {
    if (origGoogleClientId === undefined) delete process.env.GOOGLE_CLIENT_ID
    else process.env.GOOGLE_CLIENT_ID = origGoogleClientId
  })

  it("returns 503 when GOOGLE_CLIENT_ID is not configured", async () => {
    delete process.env.GOOGLE_CLIENT_ID
    const { GET } = await import("@/app/api/import/gdrive/files/route")
    const res = await GET(new Request("http://localhost/api/import/gdrive/files"))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe("google_drive_not_configured")
  })

  it("returns 401 when unauthenticated", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client"
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/import/gdrive/files/route")
    const res = await GET(new Request("http://localhost/api/import/gdrive/files"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when no Google Drive integration is connected for this org", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client"
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.googleDriveIntegration.findUnique).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/import/gdrive/files/route")
    const res = await GET(new Request("http://localhost/api/import/gdrive/files"))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("Not Found")
  })

  it("returns 502 when listDriveFiles throws upstream error", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client"
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.googleDriveIntegration.findUnique).mockResolvedValueOnce({
      id: "gdrive-1",
      organizationId: "org-1",
    } as any)
    vi.mocked(listDriveFiles).mockRejectedValueOnce(new Error("token expired"))
    const { GET } = await import("@/app/api/import/gdrive/files/route")
    const res = await GET(new Request("http://localhost/api/import/gdrive/files?folderId=root"))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe("drive_list_failed")
  })

  it("returns 200 with file list on success", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client"
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.googleDriveIntegration.findUnique).mockResolvedValueOnce({
      id: "gdrive-1",
      organizationId: "org-1",
    } as any)
    vi.mocked(listDriveFiles).mockResolvedValueOnce({
      files: [
        { id: "file-1", name: "Contract.pdf", mimeType: "application/pdf", sizeBytes: 12345, modifiedAt: "2026-01-01T00:00:00Z" },
      ],
      truncated: false,
    })
    const { GET } = await import("@/app/api/import/gdrive/files/route")
    const res = await GET(new Request("http://localhost/api/import/gdrive/files?folderId=root"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.files).toHaveLength(1)
    expect(body.files[0].name).toBe("Contract.pdf")
    expect(body.folderId).toBe("root")
  })
})

// ─── GET /api/import/gdrive/callback ─────────────────────────────────────────

describe("GET /api/import/gdrive/callback", () => {
  const origClientId = process.env.GOOGLE_CLIENT_ID
  const origClientSecret = process.env.GOOGLE_CLIENT_SECRET

  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })
  afterEach(() => {
    if (origClientId === undefined) delete process.env.GOOGLE_CLIENT_ID
    else process.env.GOOGLE_CLIENT_ID = origClientId
    if (origClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET
    else process.env.GOOGLE_CLIENT_SECRET = origClientSecret
  })

  it("redirects to settings with not_configured error when env vars are missing", async () => {
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    const { GET } = await import("@/app/api/import/gdrive/callback/route")
    const res = await GET(new Request("http://localhost/api/import/gdrive/callback?code=abc&state=xyz"))
    expect(res.status).toBe(302)
    const location = res.headers.get("Location") ?? ""
    expect(location).toContain("not_configured")
  })

  it("redirects with unauthenticated error when session is missing", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-id"
    process.env.GOOGLE_CLIENT_SECRET = "client-secret"
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/import/gdrive/callback/route")
    const res = await GET(new Request("http://localhost/api/import/gdrive/callback?code=abc&state=xyz"))
    expect(res.status).toBe(302)
    const location = res.headers.get("Location") ?? ""
    expect(location).toContain("unauthenticated")
  })

  it("redirects with forbidden error when user is not admin", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-id"
    process.env.GOOGLE_CLIENT_SECRET = "client-secret"
    vi.mocked(resolveAuth).mockResolvedValueOnce(legalCtx)
    const { GET } = await import("@/app/api/import/gdrive/callback/route")
    const res = await GET(new Request("http://localhost/api/import/gdrive/callback?code=abc&state=xyz"))
    expect(res.status).toBe(302)
    const location = res.headers.get("Location") ?? ""
    expect(location).toContain("forbidden")
  })

  it("redirects with missing_params error when code or state is absent", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-id"
    process.env.GOOGLE_CLIENT_SECRET = "client-secret"
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { GET } = await import("@/app/api/import/gdrive/callback/route")
    const res = await GET(new Request("http://localhost/api/import/gdrive/callback"))
    expect(res.status).toBe(302)
    const location = res.headers.get("Location") ?? ""
    expect(location).toContain("missing_params")
  })

  it("redirects with state_mismatch when cookie state does not match query state", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-id"
    process.env.GOOGLE_CLIENT_SECRET = "client-secret"
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    const { GET } = await import("@/app/api/import/gdrive/callback/route")
    const res = await GET(
      new Request("http://localhost/api/import/gdrive/callback?code=abc&state=state-123", {
        headers: { cookie: "gdrive_oauth_state=state-WRONG" },
      }),
    )
    expect(res.status).toBe(302)
    const location = res.headers.get("Location") ?? ""
    expect(location).toContain("state_mismatch")
  })
})

// ─── GET /api/import/[jobId] ─────────────────────────────────────────────────

describe("GET /api/import/[jobId]", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/import/[jobId]/route")
    const res = await GET(
      new Request("http://localhost/api/import/job-abc"),
      { params: { jobId: "job-abc" } },
    )
    expect(res.status).toBe(401)
  })

  it("returns 404 when job does not exist", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.importJob.findUnique).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/import/[jobId]/route")
    const res = await GET(
      new Request("http://localhost/api/import/job-missing"),
      { params: { jobId: "job-missing" } },
    )
    expect(res.status).toBe(404)
  })

  it("returns 404 when job belongs to a different org (org isolation)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx) // org-1
    vi.mocked(prisma.importJob.findUnique).mockResolvedValueOnce({
      id: "job-other",
      organizationId: "org-2", // ← different org
      totalRows: 3,
    } as any)
    const { GET } = await import("@/app/api/import/[jobId]/route")
    const res = await GET(
      new Request("http://localhost/api/import/job-other"),
      { params: { jobId: "job-other" } },
    )
    expect(res.status).toBe(404)
  })

  it("returns 200 with job and rows for a small job (< 200 rows — all statuses)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.importJob.findUnique).mockResolvedValueOnce({
      id: "job-abc",
      organizationId: "org-1",
      totalRows: 5,
      status: "COMPLETED",
      createdBy: { id: "user-admin", name: "Admin" },
    } as any)
    vi.mocked(prisma.importRow.findMany).mockResolvedValueOnce([
      { id: "row-1", rowIndex: 0, sourceRef: "Acme NDA", status: "success", errorMessage: null, contractId: "contract-1" },
      { id: "row-2", rowIndex: 1, sourceRef: "Beta MSA", status: "failed", errorMessage: "Parse error", contractId: null },
    ] as any)
    const { GET } = await import("@/app/api/import/[jobId]/route")
    const res = await GET(
      new Request("http://localhost/api/import/job-abc"),
      { params: { jobId: "job-abc" } },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.job).toMatchObject({ id: "job-abc", status: "COMPLETED" })
    expect(body.rows).toHaveLength(2)
    // All rows returned for small jobs
    expect(prisma.importRow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jobId: "job-abc" } }),
    )
  })

  it("returns only failed rows for a large job (>= 200 rows)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.importJob.findUnique).mockResolvedValueOnce({
      id: "job-large",
      organizationId: "org-1",
      totalRows: 500,
      status: "COMPLETED",
      createdBy: { id: "user-admin", name: "Admin" },
    } as any)
    vi.mocked(prisma.importRow.findMany).mockResolvedValueOnce([
      { id: "row-fail", rowIndex: 3, sourceRef: "Row 3", status: "failed", errorMessage: "Error", contractId: null },
    ] as any)
    const { GET } = await import("@/app/api/import/[jobId]/route")
    const res = await GET(
      new Request("http://localhost/api/import/job-large"),
      { params: { jobId: "job-large" } },
    )
    expect(res.status).toBe(200)
    expect(prisma.importRow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jobId: "job-large", status: "failed" } }),
    )
  })
})

// ─── POST /api/import/[jobId]/retry ──────────────────────────────────────────

describe("POST /api/import/[jobId]/retry", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/import/[jobId]/retry/route")
    const res = await POST(
      new Request("http://localhost/api/import/job-abc/retry", { method: "POST" }),
      { params: { jobId: "job-abc" } },
    )
    expect(res.status).toBe(401)
  })

  it("returns 404 when job does not exist", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.importJob.findUnique).mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/import/[jobId]/retry/route")
    const res = await POST(
      new Request("http://localhost/api/import/job-missing/retry", { method: "POST" }),
      { params: { jobId: "job-missing" } },
    )
    expect(res.status).toBe(404)
  })

  it("returns 404 when job belongs to a different org (org isolation)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.importJob.findUnique).mockResolvedValueOnce({
      id: "job-other",
      organizationId: "org-2",
      status: "FAILED",
    } as any)
    const { POST } = await import("@/app/api/import/[jobId]/retry/route")
    const res = await POST(
      new Request("http://localhost/api/import/job-other/retry", { method: "POST" }),
      { params: { jobId: "job-other" } },
    )
    expect(res.status).toBe(404)
  })

  it("returns 422 when job is still in PENDING status (not finished)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.importJob.findUnique).mockResolvedValueOnce({
      id: "job-pending",
      organizationId: "org-1",
      status: "PENDING",
    } as any)
    const { POST } = await import("@/app/api/import/[jobId]/retry/route")
    const res = await POST(
      new Request("http://localhost/api/import/job-pending/retry", { method: "POST" }),
      { params: { jobId: "job-pending" } },
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe("job_not_finished")
  })

  it("returns 422 when job is RUNNING (not finished)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.importJob.findUnique).mockResolvedValueOnce({
      id: "job-running",
      organizationId: "org-1",
      status: "RUNNING",
    } as any)
    const { POST } = await import("@/app/api/import/[jobId]/retry/route")
    const res = await POST(
      new Request("http://localhost/api/import/job-running/retry", { method: "POST" }),
      { params: { jobId: "job-running" } },
    )
    expect(res.status).toBe(422)
  })

  it("returns 202 and resets job + failed rows on success", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.importJob.findUnique).mockResolvedValueOnce({
      id: "job-failed",
      organizationId: "org-1",
      status: "FAILED",
    } as any)
    vi.mocked(prisma.importJob.update).mockResolvedValueOnce({} as any)
    vi.mocked(prisma.importRow.updateMany).mockResolvedValueOnce({ count: 3 } as any)
    const { POST } = await import("@/app/api/import/[jobId]/retry/route")
    const res = await POST(
      new Request("http://localhost/api/import/job-failed/retry", { method: "POST" }),
      { params: { jobId: "job-failed" } },
    )
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.jobId).toBe("job-failed")
    expect(prisma.importJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-failed" },
        data: expect.objectContaining({ status: "PENDING" }),
      }),
    )
    expect(prisma.importRow.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: "job-failed", status: "failed" },
        data: expect.objectContaining({ status: "pending", errorMessage: null }),
      }),
    )
    expect(enqueueImportProcess).toHaveBeenCalledWith(
      expect.objectContaining({ importJobId: "job-failed" }),
    )
  })

  it("returns 202 even when enqueue fails (best-effort)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.importJob.findUnique).mockResolvedValueOnce({
      id: "job-completed",
      organizationId: "org-1",
      status: "COMPLETED",
    } as any)
    vi.mocked(prisma.importJob.update).mockResolvedValueOnce({} as any)
    vi.mocked(prisma.importRow.updateMany).mockResolvedValueOnce({ count: 0 } as any)
    vi.mocked(enqueueImportProcess).mockRejectedValueOnce(new Error("Redis down"))
    const { POST } = await import("@/app/api/import/[jobId]/retry/route")
    const res = await POST(
      new Request("http://localhost/api/import/job-completed/retry", { method: "POST" }),
      { params: { jobId: "job-completed" } },
    )
    expect(res.status).toBe(202)
  })
})

// ─── GET /api/import/[jobId]/error-report ────────────────────────────────────

describe("GET /api/import/[jobId]/error-report", () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockQueues() })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/import/[jobId]/error-report/route")
    const res = await GET(
      new Request("http://localhost/api/import/job-abc/error-report"),
      { params: { jobId: "job-abc" } },
    )
    expect(res.status).toBe(401)
  })

  it("returns 404 when job does not exist", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.importJob.findUnique).mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/import/[jobId]/error-report/route")
    const res = await GET(
      new Request("http://localhost/api/import/job-missing/error-report"),
      { params: { jobId: "job-missing" } },
    )
    expect(res.status).toBe(404)
  })

  it("returns 404 when job belongs to a different org (org isolation)", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.importJob.findUnique).mockResolvedValueOnce({
      id: "job-other",
      organizationId: "org-2",
      errorReportKey: "some-key",
    } as any)
    const { GET } = await import("@/app/api/import/[jobId]/error-report/route")
    const res = await GET(
      new Request("http://localhost/api/import/job-other/error-report"),
      { params: { jobId: "job-other" } },
    )
    expect(res.status).toBe(404)
  })

  it("returns 404 when job has no error report", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.importJob.findUnique).mockResolvedValueOnce({
      id: "job-abc",
      organizationId: "org-1",
      errorReportKey: null, // no error report
    } as any)
    const { GET } = await import("@/app/api/import/[jobId]/error-report/route")
    const res = await GET(
      new Request("http://localhost/api/import/job-abc/error-report"),
      { params: { jobId: "job-abc" } },
    )
    expect(res.status).toBe(404)
  })

  it("returns 502 when signed URL generation fails", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.importJob.findUnique).mockResolvedValueOnce({
      id: "job-abc",
      organizationId: "org-1",
      errorReportKey: "imports/org-1/job-abc/errors.csv",
    } as any)
    vi.mocked(storage.getSignedDownloadUrl).mockRejectedValueOnce(new Error("signing failed"))
    const { GET } = await import("@/app/api/import/[jobId]/error-report/route")
    const res = await GET(
      new Request("http://localhost/api/import/job-abc/error-report"),
      { params: { jobId: "job-abc" } },
    )
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe("signing_failed")
  })

  it("returns 302 redirect to the signed download URL on success", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(adminCtx)
    vi.mocked(prisma.importJob.findUnique).mockResolvedValueOnce({
      id: "job-abc",
      organizationId: "org-1",
      errorReportKey: "imports/org-1/job-abc/errors.csv",
    } as any)
    vi.mocked(storage.getSignedDownloadUrl).mockResolvedValueOnce("https://s3.example.com/signed-errors.csv")
    const { GET } = await import("@/app/api/import/[jobId]/error-report/route")
    const res = await GET(
      new Request("http://localhost/api/import/job-abc/error-report"),
      { params: { jobId: "job-abc" } },
    )
    expect(res.status).toBe(302)
    expect(res.headers.get("Location")).toBe("https://s3.example.com/signed-errors.csv")
  })
})

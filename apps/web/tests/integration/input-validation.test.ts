import { describe, it, expect, vi, beforeEach } from "vitest"
import { prisma } from "@/lib/db/client"

vi.mock("@/lib/auth/middleware", () => ({
  resolveAuth: vi.fn().mockResolvedValue({
    userId: "user-1",
    organizationId: "org-1",
    role: "admin",
    source: "session" as const,
  }),
}))

vi.mock("@/lib/db/activity", () => ({
  writeActivity: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/storage", () => ({
  storage: {
    storageKey: vi.fn().mockReturnValue("org-1/contract-1/file.pdf"),
    upload: vi.fn().mockResolvedValue(undefined),
    getSignedDownloadUrl: vi.fn().mockResolvedValue("https://example.com/signed"),
  },
}))

describe("Input validation — contract creation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects empty title (min 1 char)", async () => {
    const { POST } = await import("@/app/api/contracts/route")
    const req = new Request("http://localhost/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "", contractType: "NDA" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it("rejects title over 500 chars", async () => {
    const { POST } = await import("@/app/api/contracts/route")
    const req = new Request("http://localhost/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "A".repeat(501), contractType: "NDA" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it("rejects invalid contractType", async () => {
    const { POST } = await import("@/app/api/contracts/route")
    const req = new Request("http://localhost/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", contractType: "INVALID_TYPE" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it("rejects negative value (must be positive)", async () => {
    const { POST } = await import("@/app/api/contracts/route")
    const req = new Request("http://localhost/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", contractType: "NDA", value: -999999999 }),
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it("rejects negative noticePeriodDays (min 0)", async () => {
    const { POST } = await import("@/app/api/contracts/route")
    const req = new Request("http://localhost/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", contractType: "NDA", noticePeriodDays: -1 }),
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it("accepts noticePeriodDays=0 (minimum valid value)", async () => {
    vi.mocked(prisma.contract.create).mockResolvedValue({
      id: "c1",
      title: "Test",
      contractType: "NDA",
      organizationId: "org-1",
      ownerId: "user-1",
      noticePeriodDays: 0,
      owner: { id: "user-1", name: "Alice", email: "a@b.com" },
      tags: [],
      folder: null,
    } as any)

    const { POST } = await import("@/app/api/contracts/route")
    const req = new Request("http://localhost/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", contractType: "NDA", noticePeriodDays: 0 }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
  })

  it("rejects invalid email for counterpartyContact", async () => {
    const { POST } = await import("@/app/api/contracts/route")
    const req = new Request("http://localhost/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", contractType: "NDA", counterpartyContact: "not-an-email" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it("accepts empty string for counterpartyContact (optional blank)", async () => {
    vi.mocked(prisma.contract.create).mockResolvedValue({
      id: "c1",
      title: "Test",
      contractType: "NDA",
      organizationId: "org-1",
      ownerId: "user-1",
      counterpartyContact: "",
      owner: { id: "user-1", name: "Alice", email: "a@b.com" },
      tags: [],
      folder: null,
    } as any)

    const { POST } = await import("@/app/api/contracts/route")
    const req = new Request("http://localhost/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", contractType: "NDA", counterpartyContact: "" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
  })

  it("rejects malformed JSON body with 400", async () => {
    const { POST } = await import("@/app/api/contracts/route")
    const req = new Request("http://localhost/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ this is not json }",
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("pagination limit=999999 is clamped to 100", async () => {
    vi.mocked(prisma.contract.findMany).mockResolvedValue([])
    vi.mocked(prisma.contract.count as any).mockResolvedValue(0)

    const { GET } = await import("@/app/api/contracts/route")
    const req = new Request("http://localhost/api/contracts?limit=999999")
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(prisma.contract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    )
  })

  it("pagination limit=0 is clamped to 1", async () => {
    vi.mocked(prisma.contract.findMany).mockResolvedValue([])
    vi.mocked(prisma.contract.count as any).mockResolvedValue(0)

    const { GET } = await import("@/app/api/contracts/route")
    const req = new Request("http://localhost/api/contracts?limit=0")
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(prisma.contract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1 }),
    )
  })

  it("title containing XSS is stored as-is (not rejected, not executed)", async () => {
    const xssTitle = "<script>alert(1)</script>"
    vi.mocked(prisma.contract.create).mockResolvedValue({
      id: "c1",
      title: xssTitle,
      contractType: "NDA",
      organizationId: "org-1",
      ownerId: "user-1",
      owner: { id: "user-1", name: "Alice", email: "a@b.com" },
      tags: [],
      folder: null,
    } as any)

    const { POST } = await import("@/app/api/contracts/route")
    const req = new Request("http://localhost/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: xssTitle, contractType: "NDA" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.title).toBe(xssTitle)
  })
})

describe("Input validation — file upload", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeUploadRequest(fileBytes: Uint8Array, filename: string): Request {
    // jsdom doesn't support multipart FormData parsing — inject a real File
    // and mock formData() with Object.defineProperty to bypass readonly
    // Slice the underlying ArrayBuffer to avoid shared-pool offset bugs and satisfy BlobPart typing
    const copy = fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength) as ArrayBuffer
    const fileObj = new File([copy], filename)
    const fd = new FormData()
    fd.append("file", fileObj)

    const req = new Request("http://localhost/api/contracts/c1/upload", { method: "POST" })
    Object.defineProperty(req, "formData", {
      value: () => Promise.resolve(fd),
      writable: true,
    })
    return req
  }

  it("rejects file without magic bytes (plain text disguised as PDF)", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValue({
      id: "c1",
      organizationId: "org-1",
    } as any)

    const { POST } = await import("@/app/api/contracts/[id]/upload/route")
    const req = makeUploadRequest(Buffer.from("Not a real PDF"), "evil.pdf")
    const res = await POST(req, { params: { id: "c1" } })

    expect(res.status).toBe(415)
  })

  it("rejects file over 50MB", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValue({
      id: "c1",
      organizationId: "org-1",
    } as any)

    const { POST } = await import("@/app/api/contracts/[id]/upload/route")

    const bigBuffer = Buffer.alloc(51 * 1024 * 1024)
    bigBuffer[0] = 0x25
    bigBuffer[1] = 0x50
    bigBuffer[2] = 0x44
    bigBuffer[3] = 0x46

    const req = makeUploadRequest(bigBuffer, "huge.pdf")
    const res = await POST(req, { params: { id: "c1" } })

    expect(res.status).toBe(413)
  })

  it("accepts valid PDF file (magic bytes %PDF)", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValue({
      id: "c1",
      organizationId: "org-1",
    } as any)
    vi.mocked(prisma.contractFile.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.contractFile.updateMany).mockResolvedValue({ count: 0 } as any)
    vi.mocked(prisma.contractFile.create).mockResolvedValue({
      id: "file-1",
      contractId: "c1",
      filename: "test.pdf",
      storageKey: "org-1/c1/test.pdf",
      mimeType: "application/pdf",
      sizeBytes: 8,
      isLatest: true,
      version: 1,
      uploadedById: "user-1",
      createdAt: new Date(),
    } as any)
    vi.mocked(prisma.contractVersion.create).mockResolvedValue({} as any)

    const { POST } = await import("@/app/api/contracts/[id]/upload/route")
    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
    const req = makeUploadRequest(pdfBytes, "test.pdf")
    const res = await POST(req, { params: { id: "c1" } })

    expect(res.status).toBe(201)
  })

  it("accepts valid DOCX file (magic bytes PK — ZIP/OOXML)", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValue({
      id: "c1",
      organizationId: "org-1",
    } as any)
    vi.mocked(prisma.contractFile.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.contractFile.updateMany).mockResolvedValue({ count: 0 } as any)
    vi.mocked(prisma.contractFile.create).mockResolvedValue({
      id: "file-1",
      contractId: "c1",
      filename: "test.docx",
      storageKey: "org-1/c1/test.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 4,
      isLatest: true,
      version: 1,
      uploadedById: "user-1",
      createdAt: new Date(),
    } as any)
    vi.mocked(prisma.contractVersion.create).mockResolvedValue({} as any)

    const { POST } = await import("@/app/api/contracts/[id]/upload/route")
    const docxBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04])
    const req = makeUploadRequest(docxBytes, "test.docx")
    const res = await POST(req, { params: { id: "c1" } })

    expect(res.status).toBe(201)
  })

  it("rejects missing file field", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValue({
      id: "c1",
      organizationId: "org-1",
    } as any)

    const { POST } = await import("@/app/api/contracts/[id]/upload/route")
    const req = new Request("http://localhost/api/contracts/c1/upload", { method: "POST" })
    Object.defineProperty(req, "formData", {
      value: () => Promise.resolve(new FormData()),
      writable: true,
    })
    const res = await POST(req, { params: { id: "c1" } })

    expect(res.status).toBe(400)
  })
})

describe("Input validation — tags", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects tag name over 50 chars", async () => {
    const { POST } = await import("@/app/api/tags/route")
    const req = new Request("http://localhost/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "T".repeat(51) }),
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it("rejects invalid hex color", async () => {
    const { POST } = await import("@/app/api/tags/route")
    const req = new Request("http://localhost/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Valid", color: "red" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })
})

describe("Input validation — folders", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects folder name over 200 chars", async () => {
    const { POST } = await import("@/app/api/folders/route")
    const req = new Request("http://localhost/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "F".repeat(201) }),
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })
})

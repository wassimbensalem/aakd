import { describe, it, expect, vi, beforeEach } from "vitest"
import { prisma } from "@/lib/db/client"

vi.mock("@/lib/auth/middleware", () => ({
  resolveAuth: vi.fn().mockResolvedValue({
    userId: "user-1",
    organizationId: "org-1",
    role: "admin",
    source: "session" as const,
  }),
  requireWriteScope: vi.fn(() => null),
}))

vi.mock("@/lib/db/activity", () => ({
  writeActivity: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/storage", () => ({
  storage: {
    storageKey: vi.fn().mockReturnValue("org-1/c1/file.pdf"),
    upload: vi.fn().mockResolvedValue(undefined),
    getSignedDownloadUrl: vi.fn().mockResolvedValue("https://example.com/signed"),
  },
}))

describe("Contract lifecycle edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("archiving an already-ARCHIVED contract returns 409 Conflict", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValue({
      id: "c1",
      status: "ARCHIVED",
      organizationId: "org-1",
    } as any)

    const { DELETE } = await import("@/app/api/contracts/[id]/route")
    const req = new Request("http://localhost/api/contracts/c1", { method: "DELETE" })
    const res = await DELETE(req, { params: { id: "c1" } })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already archived/i)
  })

  it("PATCH rejects invalid status transition ACTIVE → DRAFT with 422", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValue({
      id: "c1",
      status: "ACTIVE",
      organizationId: "org-1",
    } as any)

    const { PATCH } = await import("@/app/api/contracts/[id]/route")
    const req = new Request("http://localhost/api/contracts/c1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "DRAFT" }),
    })
    const res = await PATCH(req, { params: { id: "c1" } })

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toMatch(/invalid transition/i)
  })

  it("PATCH allows valid status transition ACTIVE → ARCHIVED", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValue({
      id: "c1",
      status: "ACTIVE",
      organizationId: "org-1",
    } as any)
    vi.mocked(prisma.contract.update).mockResolvedValue({
      id: "c1",
      status: "ARCHIVED",
      organizationId: "org-1",
      owner: { id: "user-1", name: "Alice", email: "a@b.com" },
      tags: [],
      folder: null,
    } as any)

    const { PATCH } = await import("@/app/api/contracts/[id]/route")
    const req = new Request("http://localhost/api/contracts/c1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ARCHIVED" }),
    })
    const res = await PATCH(req, { params: { id: "c1" } })

    expect(res.status).toBe(200)
  })

  it("duplicate filename upload — second upload creates version 2 with new version number", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValue({
      id: "c1",
      organizationId: "org-1",
    } as any)
    vi.mocked(prisma.contractFile.findFirst).mockResolvedValue({
      version: 1,
    } as any)
    vi.mocked(prisma.contractFile.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.contractFile.create).mockResolvedValue({
      id: "file-2",
      contractId: "c1",
      filename: "test.pdf",
      storageKey: "org-1/c1/test.pdf",
      mimeType: "application/pdf",
      sizeBytes: 8,
      isLatest: true,
      version: 2,
      uploadedById: "user-1",
      createdAt: new Date(),
    } as any)
    vi.mocked(prisma.contractVersion.create).mockResolvedValue({} as any)

    const { POST } = await import("@/app/api/contracts/[id]/upload/route")
    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
    const fileObj = new File([pdfBytes], "test.pdf")
    const fd = new FormData()
    fd.append("file", fileObj)

    const req = new Request("http://localhost/api/contracts/c1/upload", { method: "POST" })
    Object.defineProperty(req, "formData", {
      value: () => Promise.resolve(fd),
      writable: true,
    })

    const res = await POST(req, { params: { id: "c1" } })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.version).toBe(2)
  })

  it("deleting a tag disconnects it from all contracts (set=[]) before deleting", async () => {
    vi.mocked(prisma.tag.findUnique).mockResolvedValue({ id: "tag-1", organizationId: "org-1" } as any)
    vi.mocked(prisma.tag.update).mockResolvedValue({} as any)
    vi.mocked(prisma.tag.delete).mockResolvedValue({} as any)

    const { DELETE } = await import("@/app/api/tags/[id]/route")
    const req = new Request("http://localhost/api/tags/tag-1", { method: "DELETE" })
    const res = await DELETE(req, { params: { id: "tag-1" } })

    expect(res.status).toBe(204)
    expect(prisma.tag.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contracts: { set: [] },
        }),
      }),
    )
    expect(prisma.tag.delete).toHaveBeenCalled()
  })

  it("deleting a non-existent tag returns 404", async () => {
    vi.mocked(prisma.tag.findUnique).mockResolvedValue(null)

    const { DELETE } = await import("@/app/api/tags/[id]/route")
    const req = new Request("http://localhost/api/tags/ghost-tag", { method: "DELETE" })
    const res = await DELETE(req, { params: { id: "ghost-tag" } })

    expect(res.status).toBe(404)
    expect(prisma.tag.delete).not.toHaveBeenCalled()
  })
})

describe("Auth enforcement — all routes require resolveAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("GET /api/contracts returns 401 without auth", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(null)

    const { GET } = await import("@/app/api/contracts/route")
    const res = await GET(new Request("http://localhost/api/contracts"))
    expect(res.status).toBe(401)
  })

  it("POST /api/contracts returns 401 without auth", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(null)

    const { POST } = await import("@/app/api/contracts/route")
    const res = await POST(new Request("http://localhost/api/contracts", { method: "POST" }))
    expect(res.status).toBe(401)
  })

  it("GET /api/contracts/[id] returns 401 without auth", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(null)

    const { GET } = await import("@/app/api/contracts/[id]/route")
    const res = await GET(new Request("http://localhost/api/contracts/c1"), { params: { id: "c1" } })
    expect(res.status).toBe(401)
  })

  it("PATCH /api/contracts/[id] returns 401 without auth", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(null)

    const { PATCH } = await import("@/app/api/contracts/[id]/route")
    const res = await PATCH(new Request("http://localhost/api/contracts/c1", { method: "PATCH" }), { params: { id: "c1" } })
    expect(res.status).toBe(401)
  })

  it("DELETE /api/contracts/[id] returns 401 without auth", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(null)

    const { DELETE } = await import("@/app/api/contracts/[id]/route")
    const res = await DELETE(new Request("http://localhost/api/contracts/c1", { method: "DELETE" }), { params: { id: "c1" } })
    expect(res.status).toBe(401)
  })

  it("POST /api/contracts/[id]/upload returns 401 without auth", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(null)

    const { POST } = await import("@/app/api/contracts/[id]/upload/route")
    const res = await POST(new Request("http://localhost/api/contracts/c1/upload", { method: "POST" }), { params: { id: "c1" } })
    expect(res.status).toBe(401)
  })

  it("GET /api/contracts/[id]/activity returns 401 without auth", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(null)

    const { GET } = await import("@/app/api/contracts/[id]/activity/route")
    const res = await GET(new Request("http://localhost/api/contracts/c1/activity"), { params: { id: "c1" } })
    expect(res.status).toBe(401)
  })

  it("GET /api/tags returns 401 without auth", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(null)

    const { GET } = await import("@/app/api/tags/route")
    const res = await GET(new Request("http://localhost/api/tags"))
    expect(res.status).toBe(401)
  })

  it("POST /api/tags returns 401 without auth", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(null)

    const { POST } = await import("@/app/api/tags/route")
    const res = await POST(new Request("http://localhost/api/tags", { method: "POST" }))
    expect(res.status).toBe(401)
  })

  it("DELETE /api/tags/[id] returns 401 without auth", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(null)

    const { DELETE } = await import("@/app/api/tags/[id]/route")
    const res = await DELETE(new Request("http://localhost/api/tags/tag-1", { method: "DELETE" }), { params: { id: "tag-1" } })
    expect(res.status).toBe(401)
  })

  it("GET /api/folders returns 401 without auth", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(null)

    const { GET } = await import("@/app/api/folders/route")
    const res = await GET(new Request("http://localhost/api/folders"))
    expect(res.status).toBe(401)
  })

  it("POST /api/folders returns 401 without auth", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(null)

    const { POST } = await import("@/app/api/folders/route")
    const res = await POST(new Request("http://localhost/api/folders", { method: "POST" }))
    expect(res.status).toBe(401)
  })

  it("GET /api/org returns 401 without auth", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(null)

    const { GET } = await import("@/app/api/org/route")
    const res = await GET(new Request("http://localhost/api/org"))
    expect(res.status).toBe(401)
  })

  it("PATCH /api/org returns 401 without auth", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(null)

    const { PATCH } = await import("@/app/api/org/route")
    const res = await PATCH(new Request("http://localhost/api/org", { method: "PATCH" }))
    expect(res.status).toBe(401)
  })

  it("GET /api/org/members returns 401 without auth", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(null)

    const { GET } = await import("@/app/api/org/members/route")
    const res = await GET(new Request("http://localhost/api/org/members"))
    expect(res.status).toBe(401)
  })

  it("GET /api/org/api-keys returns 401 without auth", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(null)

    const { GET } = await import("@/app/api/org/api-keys/route")
    const res = await GET(new Request("http://localhost/api/org/api-keys"))
    expect(res.status).toBe(401)
  })

  it("POST /api/org/api-keys returns 401 without auth", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(null)

    const { POST } = await import("@/app/api/org/api-keys/route")
    const res = await POST(new Request("http://localhost/api/org/api-keys", { method: "POST" }))
    expect(res.status).toBe(401)
  })

  it("DELETE /api/org/api-keys/[id] returns 401 without auth", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(null)

    const { DELETE } = await import("@/app/api/org/api-keys/[id]/route")
    const res = await DELETE(new Request("http://localhost/api/org/api-keys/key-1", { method: "DELETE" }), { params: { id: "key-1" } })
    expect(res.status).toBe(401)
  })
})

describe("RBAC — role enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("viewer cannot access GET /api/org/api-keys (requires admin)", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue({
      userId: "user-1",
      organizationId: "org-1",
      role: "viewer",
      source: "session",
    })

    const { GET } = await import("@/app/api/org/api-keys/route")
    const res = await GET(new Request("http://localhost/api/org/api-keys"))
    expect(res.status).toBe(403)
  })

  it("member cannot access POST /api/org/api-keys (requires admin)", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue({
      userId: "user-1",
      organizationId: "org-1",
      role: "member",
      source: "session",
    })

    const { POST } = await import("@/app/api/org/api-keys/route")
    const res = await POST(new Request("http://localhost/api/org/api-keys", { method: "POST" }))
    expect(res.status).toBe(403)
  })

  it("viewer cannot invite members (requires legal or above)", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue({
      userId: "user-1",
      organizationId: "org-1",
      role: "viewer",
      source: "session",
    })

    const { POST } = await import("@/app/api/org/members/invite/route")
    const res = await POST(new Request("http://localhost/api/org/members/invite", { method: "POST" }))
    expect(res.status).toBe(403)
  })

  it("member cannot update org settings (requires admin)", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue({
      userId: "user-1",
      organizationId: "org-1",
      role: "member",
      source: "session",
    })

    const { PATCH } = await import("@/app/api/org/route")
    const res = await PATCH(new Request("http://localhost/api/org", { method: "PATCH" }))
    expect(res.status).toBe(403)
  })
})

describe("Activity log completeness", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("POST /api/contracts logs CREATED activity", async () => {
    vi.mocked(prisma.contract.create).mockResolvedValue({
      id: "c1",
      title: "Test",
      contractType: "NDA",
      organizationId: "org-1",
      ownerId: "user-1",
      owner: { id: "user-1", name: "Alice", email: "a@b.com" },
      tags: [],
      folder: null,
    } as any)

    const { writeActivity } = await import("@/lib/db/activity")
    const { POST } = await import("@/app/api/contracts/route")

    const req = new Request("http://localhost/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", contractType: "NDA" }),
    })
    await POST(req)

    expect(writeActivity).toHaveBeenCalledWith("c1", "user-1", "CREATED")
  })

  it("PATCH /api/contracts/[id] logs UPDATED activity", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValue({ id: "c1", status: "DRAFT" } as any)
    vi.mocked(prisma.contract.update).mockResolvedValue({
      id: "c1",
      title: "Updated",
      organizationId: "org-1",
      owner: { id: "user-1", name: "Alice", email: "a@b.com" },
      tags: [],
      folder: null,
    } as any)

    const { writeActivity } = await import("@/lib/db/activity")
    const { PATCH } = await import("@/app/api/contracts/[id]/route")

    const req = new Request("http://localhost/api/contracts/c1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated" }),
    })
    await PATCH(req, { params: { id: "c1" } })

    expect(writeActivity).toHaveBeenCalledWith("c1", "user-1", "UPDATED", expect.any(String))
  })

  it("DELETE /api/contracts/[id] logs ARCHIVED activity", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValue({ id: "c1" } as any)
    vi.mocked(prisma.contract.update).mockResolvedValue({ id: "c1", status: "ARCHIVED" } as any)

    const { writeActivity } = await import("@/lib/db/activity")
    const { DELETE } = await import("@/app/api/contracts/[id]/route")

    const req = new Request("http://localhost/api/contracts/c1", { method: "DELETE" })
    await DELETE(req, { params: { id: "c1" } })

    expect(writeActivity).toHaveBeenCalledWith("c1", "user-1", "ARCHIVED")
  })

  it("POST /api/contracts/[id]/upload logs UPLOADED activity", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValue({ id: "c1", organizationId: "org-1" } as any)
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

    const { writeActivity } = await import("@/lib/db/activity")
    const { POST } = await import("@/app/api/contracts/[id]/upload/route")

    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
    const fileObj = new File([pdfBytes], "test.pdf")
    const fd = new FormData()
    fd.append("file", fileObj)

    const req = new Request("http://localhost/api/contracts/c1/upload", { method: "POST" })
    Object.defineProperty(req, "formData", {
      value: () => Promise.resolve(fd),
      writable: true,
    })

    await POST(req, { params: { id: "c1" } })

    expect(writeActivity).toHaveBeenCalledWith("c1", "user-1", "UPLOADED", expect.any(String))
  })

  it("status change via PATCH logs STATUS_CHANGED activity (DRAFT → INTERNAL_REVIEW)", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValue({ id: "c1", status: "DRAFT" } as any)
    vi.mocked(prisma.contract.update).mockResolvedValue({
      id: "c1",
      status: "INTERNAL_REVIEW",
      organizationId: "org-1",
      owner: { id: "user-1", name: "Alice", email: "a@b.com" },
      tags: [],
      folder: null,
    } as any)

    const { writeActivity } = await import("@/lib/db/activity")
    const { PATCH } = await import("@/app/api/contracts/[id]/route")

    const req = new Request("http://localhost/api/contracts/c1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "INTERNAL_REVIEW" }),
    })
    await PATCH(req, { params: { id: "c1" } })

    expect(writeActivity).toHaveBeenCalledWith("c1", "user-1", "STATUS_CHANGED", "DRAFT → INTERNAL_REVIEW")
  })
})

describe("Org-level isolation for member/API key operations", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("org B admin cannot revoke an API key from org A", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue({
      userId: "user-b",
      organizationId: "org-b",
      role: "admin",
      source: "session",
    })

    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue({
      id: "key-1",
      organizationId: "org-a",
      revokedAt: null,
    } as any)

    const { DELETE } = await import("@/app/api/org/api-keys/[id]/route")
    const req = new Request("http://localhost/api/org/api-keys/key-1", { method: "DELETE" })
    const res = await DELETE(req, { params: { id: "key-1" } })

    expect(res.status).toBe(404)
    expect(prisma.apiKey.update).not.toHaveBeenCalled()
  })

  it("org B admin cannot update a member from org A", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue({
      userId: "user-b",
      organizationId: "org-b",
      role: "admin",
      source: "session",
    })

    vi.mocked(prisma.member.findUnique).mockResolvedValue({
      id: "member-1",
      organizationId: "org-a",
    } as any)

    const { PATCH } = await import("@/app/api/org/members/[id]/route")
    const req = new Request("http://localhost/api/org/members/member-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    })
    const res = await PATCH(req, { params: { id: "member-1" } })

    expect(res.status).toBe(404)
    expect(prisma.member.update).not.toHaveBeenCalled()
  })
})

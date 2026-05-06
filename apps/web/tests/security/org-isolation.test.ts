import { describe, it, expect, vi, beforeEach } from "vitest"
import { prisma } from "@/lib/db/client"

vi.mock("@/lib/auth/middleware", () => ({
  resolveAuth: vi.fn(),
}))

vi.mock("@/lib/db/activity", () => ({
  writeActivity: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/storage", () => ({
  storage: {
    storageKey: vi.fn().mockReturnValue("org-a/contract-id/file.pdf"),
    upload: vi.fn().mockResolvedValue(undefined),
    getSignedDownloadUrl: vi.fn().mockResolvedValue("https://example.com/signed"),
  },
}))

describe("Org isolation — cross-org access must return 404", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it("user in org B cannot read a contract that belongs to org A — returns 404 not 403", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue({
      userId: "user-b",
      organizationId: "org-b",
      role: "admin",
      source: "session",
    })
    vi.mocked(prisma.contract.findUnique).mockResolvedValue(null)

    const { GET } = await import("@/app/api/contracts/[id]/route")
    const req = new Request("http://localhost/api/contracts/org-a-contract-id")
    const res = await GET(req, { params: { id: "org-a-contract-id" } })

    expect(res.status).toBe(404)
  })

  it("user in org B cannot PATCH a contract that belongs to org A — returns 404", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue({
      userId: "user-b",
      organizationId: "org-b",
      role: "admin",
      source: "session",
    })
    vi.mocked(prisma.contract.findUnique).mockResolvedValue(null)

    const { PATCH } = await import("@/app/api/contracts/[id]/route")
    const req = new Request("http://localhost/api/contracts/org-a-contract-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hijacked" }),
    })
    const res = await PATCH(req, { params: { id: "org-a-contract-id" } })

    expect(res.status).toBe(404)
  })

  it("user in org B cannot DELETE (archive) a contract that belongs to org A — returns 404", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue({
      userId: "user-b",
      organizationId: "org-b",
      role: "admin",
      source: "session",
    })
    vi.mocked(prisma.contract.findUnique).mockResolvedValue(null)

    const { DELETE } = await import("@/app/api/contracts/[id]/route")
    const req = new Request("http://localhost/api/contracts/org-a-contract-id", { method: "DELETE" })
    const res = await DELETE(req, { params: { id: "org-a-contract-id" } })

    expect(res.status).toBe(404)
  })

  it("user in org B cannot upload a file to a contract belonging to org A — returns 404", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue({
      userId: "user-b",
      organizationId: "org-b",
      role: "admin",
      source: "session",
    })
    vi.mocked(prisma.contract.findUnique).mockResolvedValue(null)

    const { POST } = await import("@/app/api/contracts/[id]/upload/route")

    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
    const formData = new FormData()
    formData.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "test.pdf")

    const req = new Request("http://localhost/api/contracts/org-a-contract-id/upload", {
      method: "POST",
      body: formData,
    })
    const res = await POST(req, { params: { id: "org-a-contract-id" } })

    expect(res.status).toBe(404)
  })

  it("tag list returns only org-scoped tags — org B user sees empty list from org B scope", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue({
      userId: "user-b",
      organizationId: "org-b",
      role: "admin",
      source: "session",
    })
    // Prisma middleware injects org-b scope — no org-a tags returned
    vi.mocked(prisma.tag.findMany).mockResolvedValue([])

    const { GET } = await import("@/app/api/tags/route")
    const req = new Request("http://localhost/api/tags")
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(0)
  })

  it("API key list is org-scoped — org B admin cannot see org A keys", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue({
      userId: "user-b",
      organizationId: "org-b",
      role: "admin",
      source: "session",
    })
    vi.mocked(prisma.apiKey.findMany).mockResolvedValue([])

    const { GET } = await import("@/app/api/org/api-keys/route")
    const req = new Request("http://localhost/api/org/api-keys")
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(0)
  })

  it("activity log for a contract belonging to org A returns 404 for org B user", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue({
      userId: "user-b",
      organizationId: "org-b",
      role: "admin",
      source: "session",
    })
    vi.mocked(prisma.contract.findUnique).mockResolvedValue(null)

    const { GET } = await import("@/app/api/contracts/[id]/activity/route")
    const req = new Request("http://localhost/api/contracts/org-a-contract-id/activity")
    const res = await GET(req, { params: { id: "org-a-contract-id" } })

    expect(res.status).toBe(404)
  })

  it("org B user cannot delete a tag belonging to org A — returns 404", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue({
      userId: "user-b",
      organizationId: "org-b",
      role: "admin",
      source: "session",
    })
    // Middleware injects org-b scope — tag from org-a returns null
    vi.mocked(prisma.tag.findUnique).mockResolvedValue(null)

    const { DELETE } = await import("@/app/api/tags/[id]/route")
    const req = new Request("http://localhost/api/tags/org-a-tag-id", { method: "DELETE" })
    const res = await DELETE(req, { params: { id: "org-a-tag-id" } })

    expect(res.status).toBe(404)
  })

  it("org B user cannot delete a folder belonging to org A — returns 404", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue({
      userId: "user-b",
      organizationId: "org-b",
      role: "admin",
      source: "session",
    })
    // Middleware injects org-b scope — folder from org-a returns null
    vi.mocked(prisma.folder.findUnique).mockResolvedValue(null)

    const { DELETE } = await import("@/app/api/folders/[id]/route")
    const req = new Request("http://localhost/api/folders/org-a-folder-id", { method: "DELETE" })
    const res = await DELETE(req, { params: { id: "org-a-folder-id" } })

    expect(res.status).toBe(404)
  })

  it("unauthenticated request returns 401 — does not leak resource existence", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(null)

    const { GET } = await import("@/app/api/contracts/[id]/route")
    const req = new Request("http://localhost/api/contracts/any-contract-id")
    const res = await GET(req, { params: { id: "any-contract-id" } })

    expect(res.status).toBe(401)
  })

  it("org A user can read their own contract", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue({
      userId: "user-a",
      organizationId: "org-a",
      role: "admin",
      source: "session",
    })
    vi.mocked(prisma.contract.findUnique).mockResolvedValue({
      id: "org-a-contract-id",
      organizationId: "org-a",
      title: "Org A Contract",
      owner: { id: "user-a", name: "Alice", email: "alice@a.com" },
      tags: [],
      folder: null,
      files: [],
      versions: [],
      activities: [],
      _count: { files: 0, versions: 0, activities: 0 },
    } as any)

    const { GET } = await import("@/app/api/contracts/[id]/route")
    const req = new Request("http://localhost/api/contracts/org-a-contract-id")
    const res = await GET(req, { params: { id: "org-a-contract-id" } })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.organizationId).toBe("org-a")
  })
})

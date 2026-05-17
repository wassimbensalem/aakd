import { describe, it, expect, vi, beforeEach } from "vitest"
import { prisma } from "@/lib/db/client"
import { requestContext } from "@/lib/context"

const mockCtx = {
  userId: "user-1",
  organizationId: "org-1",
  role: "admin",
  source: "session" as const,
  requestId: "test-request-id",
}

vi.mock("@/lib/auth/middleware", () => ({
  resolveAuth: vi.fn().mockResolvedValue(mockCtx),
  requireWriteScope: vi.fn(() => null),
}))

vi.mock("@/lib/db/activity", () => ({
  writeActivity: vi.fn().mockResolvedValue(undefined),
}))

describe("POST /api/contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("creates a contract with correct orgId injected by context", async () => {
    const mockContract = {
      id: "contract-1",
      title: "Test NDA",
      contractType: "NDA",
      organizationId: "org-1",
      ownerId: "user-1",
      status: "DRAFT",
      owner: { id: "user-1", name: "Alice", email: "alice@example.com" },
      tags: [],
      folder: null,
    }

    vi.mocked(prisma.contract.create).mockResolvedValue(mockContract as any)

    const { POST } = await import("@/app/api/contracts/route")

    const req = new Request("http://localhost/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test NDA", contractType: "NDA" }),
    })

    const res = await POST(req)
    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body.organizationId).toBe("org-1")
    expect(prisma.contract.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Test NDA",
          owner: { connect: { id: "user-1" } },
        }),
      }),
    )
  })
})

describe("GET /api/contracts", () => {
  it("lists only contracts for the current org", async () => {
    const mockContracts = [
      {
        id: "c1",
        title: "Org1 Contract",
        organizationId: "org-1",
        owner: { id: "user-1", name: "Alice", email: "alice@example.com" },
        tags: [],
        folder: null,
        _count: { files: 0 },
      },
    ]

    vi.mocked(prisma.contract.findMany).mockResolvedValue(mockContracts as any)
    vi.mocked(prisma.contract.count as any).mockResolvedValue(1)

    const { GET } = await import("@/app/api/contracts/route")

    const req = new Request("http://localhost/api/contracts")
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.contracts).toHaveLength(1)
    expect(body.contracts[0].organizationId).toBe("org-1")
  })
})

describe("PATCH /api/contracts/[id]", () => {
  it("updates a contract and logs UPDATED activity", async () => {
    const { writeActivity } = await import("@/lib/db/activity")

    vi.mocked(prisma.contract.findUnique).mockResolvedValue({
      id: "c1",
      status: "DRAFT",
    } as any)

    vi.mocked(prisma.contract.update).mockResolvedValue({
      id: "c1",
      title: "Updated Title",
      organizationId: "org-1",
      owner: { id: "user-1", name: "Alice", email: "alice@example.com" },
      tags: [],
      folder: null,
    } as any)

    const { PATCH } = await import("@/app/api/contracts/[id]/route")

    const req = new Request("http://localhost/api/contracts/c1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated Title" }),
    })

    const res = await PATCH(req, { params: { id: "c1" } })
    expect(res.status).toBe(200)
    expect(writeActivity).toHaveBeenCalledWith("c1", "user-1", "UPDATED", expect.any(String))
  })
})

describe("DELETE /api/contracts/[id]", () => {
  it("archives contract (status=ARCHIVED) instead of hard-deleting", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValue({ id: "c1" } as any)
    vi.mocked(prisma.contract.update).mockResolvedValue({ id: "c1", status: "ARCHIVED" } as any)

    const { DELETE } = await import("@/app/api/contracts/[id]/route")

    const req = new Request("http://localhost/api/contracts/c1", { method: "DELETE" })
    const res = await DELETE(req, { params: { id: "c1" } })

    expect(res.status).toBe(204)
    expect(prisma.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ARCHIVED" }),
      }),
    )
  })

  it("returns 404 when contract not found", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValue(null)

    const { DELETE } = await import("@/app/api/contracts/[id]/route")

    const req = new Request("http://localhost/api/contracts/ghost", { method: "DELETE" })
    const res = await DELETE(req, { params: { id: "ghost" } })

    expect(res.status).toBe(404)
  })
})

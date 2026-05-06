import { describe, it, expect, vi, beforeEach } from "vitest"
import { prisma } from "@/lib/db/client"
import { requestContext } from "@/lib/context"

const mockCtx = {
  userId: "user-1",
  organizationId: "org-1",
  role: "admin",
  source: "session" as const,
}

vi.mock("@/lib/auth/middleware", () => ({
  resolveAuth: vi.fn().mockResolvedValue(mockCtx),
}))

vi.mock("@/lib/db/activity", () => ({
  writeActivity: vi.fn().mockResolvedValue(undefined),
}))

const mockContract = {
  id: "contract-1",
  organizationId: "org-1",
}

const mockExtraction = {
  id: "extraction-1",
  contractId: "contract-1",
  field: "startDate",
  rawValue: "2024-01-01",
  confidence: 0.85,
  sourceText: null,
  sourcePage: null,
  extractedBy: "ai",
  status: "pending",
  createdAt: new Date(),
  updatedAt: new Date(),
}

// ─── GET tests ────────────────────────────────────────────────────────────────

describe("GET /api/contracts/[id]/extractions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)

    const { GET } = await import("@/app/api/contracts/[id]/extractions/route")

    const req = new Request("http://localhost/api/contracts/contract-1/extractions")
    const res = await GET(req, { params: { id: "contract-1" } })

    expect(res.status).toBe(401)
  })

  it("returns 404 when contract belongs to another org", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      ...mockContract,
      organizationId: "org-different",
    } as any)

    const { GET } = await import("@/app/api/contracts/[id]/extractions/route")

    const req = new Request("http://localhost/api/contracts/contract-1/extractions")
    const res = await requestContext.run(mockCtx, () =>
      GET(req, { params: { id: "contract-1" } }),
    )

    expect(res.status).toBe(404)
  })

  it("returns extractions ordered by createdAt", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(mockContract as any)
    vi.mocked(prisma.aIExtraction.findMany).mockResolvedValueOnce([mockExtraction] as any)

    const { GET } = await import("@/app/api/contracts/[id]/extractions/route")

    const req = new Request("http://localhost/api/contracts/contract-1/extractions")
    const res = await requestContext.run(mockCtx, () =>
      GET(req, { params: { id: "contract-1" } }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)
    expect(body[0].field).toBe("startDate")
  })
})

// ─── PATCH tests ─────────────────────────────────────────────────────────────

describe("PATCH /api/contracts/[id]/extractions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)

    const { PATCH } = await import("@/app/api/contracts/[id]/extractions/route")

    const req = new Request("http://localhost/api/contracts/contract-1/extractions", {
      method: "PATCH",
      body: JSON.stringify({ extractionId: "extraction-1", action: "accept" }),
    })
    const res = await PATCH(req, { params: { id: "contract-1" } })

    expect(res.status).toBe(401)
  })

  it("returns 400 on invalid body (missing action)", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(mockContract as any)

    const { PATCH } = await import("@/app/api/contracts/[id]/extractions/route")

    const req = new Request("http://localhost/api/contracts/contract-1/extractions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extractionId: "extraction-1" }), // missing action
    })
    const res = await requestContext.run(mockCtx, () =>
      PATCH(req, { params: { id: "contract-1" } }),
    )

    expect(res.status).toBe(400)
  })

  it("returns 404 when extraction belongs to different contract", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(mockContract as any)
    vi.mocked(prisma.aIExtraction.findUnique).mockResolvedValueOnce({
      ...mockExtraction,
      contractId: "contract-different", // mismatch
    } as any)

    const { PATCH } = await import("@/app/api/contracts/[id]/extractions/route")

    const req = new Request("http://localhost/api/contracts/contract-1/extractions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extractionId: "extraction-1", action: "accept" }),
    })
    const res = await requestContext.run(mockCtx, () =>
      PATCH(req, { params: { id: "contract-1" } }),
    )

    expect(res.status).toBe(404)
  })

  it("accepts an extraction and updates contract field", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(mockContract as any)
    vi.mocked(prisma.aIExtraction.findUnique).mockResolvedValueOnce(mockExtraction as any)
    vi.mocked(prisma.aIExtraction.update).mockResolvedValueOnce({
      ...mockExtraction,
      status: "accepted",
    } as any)
    vi.mocked(prisma.contract.update).mockResolvedValueOnce({} as any)
    vi.mocked(prisma.aIExtraction.findUnique).mockResolvedValueOnce({
      ...mockExtraction,
      status: "accepted",
    } as any)

    const { PATCH } = await import("@/app/api/contracts/[id]/extractions/route")

    const req = new Request("http://localhost/api/contracts/contract-1/extractions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extractionId: "extraction-1", action: "accept" }),
    })
    const res = await requestContext.run(mockCtx, () =>
      PATCH(req, { params: { id: "contract-1" } }),
    )

    expect(res.status).toBe(200)

    // Should have updated the extraction status
    expect(prisma.aIExtraction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "extraction-1" },
        data: { status: "accepted" },
      }),
    )

    // Should have applied value to canonical Contract field
    expect(prisma.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "contract-1" },
        data: expect.objectContaining({ startDate: expect.any(Date) }),
      }),
    )
  })

  it("rejects an extraction without updating contract", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(mockContract as any)
    vi.mocked(prisma.aIExtraction.findUnique).mockResolvedValueOnce(mockExtraction as any)
    vi.mocked(prisma.aIExtraction.update).mockResolvedValueOnce({
      ...mockExtraction,
      status: "rejected",
    } as any)
    vi.mocked(prisma.aIExtraction.findUnique).mockResolvedValueOnce({
      ...mockExtraction,
      status: "rejected",
    } as any)

    const { PATCH } = await import("@/app/api/contracts/[id]/extractions/route")

    const req = new Request("http://localhost/api/contracts/contract-1/extractions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extractionId: "extraction-1", action: "reject" }),
    })
    const res = await requestContext.run(mockCtx, () =>
      PATCH(req, { params: { id: "contract-1" } }),
    )

    expect(res.status).toBe(200)

    expect(prisma.aIExtraction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "extraction-1" },
        data: { status: "rejected" },
      }),
    )

    // Should NOT update the contract for a rejected extraction
    expect(prisma.contract.update).not.toHaveBeenCalled()
  })

  it("returns 404 when contract is from different org (org isolation)", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      id: "contract-1",
      organizationId: "org-attacker",
    } as any)

    const { PATCH } = await import("@/app/api/contracts/[id]/extractions/route")

    const req = new Request("http://localhost/api/contracts/contract-1/extractions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extractionId: "extraction-1", action: "accept" }),
    })
    const res = await requestContext.run(mockCtx, () =>
      PATCH(req, { params: { id: "contract-1" } }),
    )

    // Must return 404, not 403 — never leak resource existence
    expect(res.status).toBe(404)
    expect(prisma.aIExtraction.update).not.toHaveBeenCalled()
  })

  it("accept_all marks all pending extractions accepted and updates contract", async () => {
    const pending = [
      { id: "ex-1", field: "counterpartyName", rawValue: "Acme Corp" },
      { id: "ex-2", field: "startDate",         rawValue: "2024-01-01" },
      { id: "ex-3", field: "value",             rawValue: "50000" },
    ]

    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(mockContract as any)
    vi.mocked(prisma.aIExtraction.findMany).mockResolvedValueOnce(pending as any)
    vi.mocked(prisma.$transaction).mockResolvedValueOnce([undefined, undefined] as any)

    const { PATCH } = await import("@/app/api/contracts/[id]/extractions/route")

    const req = new Request("http://localhost/api/contracts/contract-1/extractions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept_all" }),
    })
    const res = await requestContext.run(mockCtx, () =>
      PATCH(req, { params: { id: "contract-1" } }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.accepted).toBe(3)
    expect(prisma.$transaction).toHaveBeenCalled()
  })

  it("accept_all returns { accepted: 0 } when no pending extractions exist", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(mockContract as any)
    vi.mocked(prisma.aIExtraction.findMany).mockResolvedValueOnce([] as any)

    const { PATCH } = await import("@/app/api/contracts/[id]/extractions/route")

    const req = new Request("http://localhost/api/contracts/contract-1/extractions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept_all" }),
    })
    const res = await requestContext.run(mockCtx, () =>
      PATCH(req, { params: { id: "contract-1" } }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.accepted).toBe(0)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("edit updates rawValue then accepts and writes to contract", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(mockContract as any)
    vi.mocked(prisma.aIExtraction.findUnique).mockResolvedValueOnce(mockExtraction as any)
    vi.mocked(prisma.aIExtraction.update).mockResolvedValue({
      ...mockExtraction,
      rawValue: "2025-06-01",
      status: "accepted",
    } as any)
    vi.mocked(prisma.contract.update).mockResolvedValueOnce({} as any)
    vi.mocked(prisma.aIExtraction.findUnique).mockResolvedValueOnce({
      ...mockExtraction,
      rawValue: "2025-06-01",
      status: "accepted",
    } as any)

    const { PATCH } = await import("@/app/api/contracts/[id]/extractions/route")

    const req = new Request("http://localhost/api/contracts/contract-1/extractions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "edit", extractionId: "extraction-1", newValue: "2025-06-01" }),
    })
    const res = await requestContext.run(mockCtx, () =>
      PATCH(req, { params: { id: "contract-1" } }),
    )

    expect(res.status).toBe(200)
    // First update call: set rawValue
    expect(prisma.aIExtraction.update).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ data: { rawValue: "2025-06-01" } }),
    )
    // Second update call: set status accepted
    expect(prisma.aIExtraction.update).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ data: { status: "accepted" } }),
    )
    // Contract field written with coerced value
    expect(prisma.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ startDate: expect.any(Date) }),
      }),
    )
  })
})

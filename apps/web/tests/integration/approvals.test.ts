import { describe, it, expect, vi, beforeEach } from "vitest"
import { prisma } from "@/lib/db/client"
import { requestContext } from "@/lib/context"

// ─── Mock auth ────────────────────────────────────────────────────────────────

const mockCtx = {
  userId: "user-1",
  organizationId: "org-1",
  role: "admin",
  source: "session" as const,
}

vi.mock("@/lib/auth/middleware", () => ({
  resolveAuth: vi.fn().mockResolvedValue(mockCtx),
  requireWriteScope: vi.fn(() => null),
}))

vi.mock("@/lib/db/activity", () => ({
  writeActivity: vi.fn().mockResolvedValue(undefined),
}))

// Silence email sending + queue enqueues in tests
vi.mock("@/lib/email/approval", () => ({
  sendApprovalRequestEmail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/jobs/queues", () => ({
  emailQueue: { add: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
  notificationFanoutQueue: { add: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockContract = {
  id: "contract-1",
  organizationId: "org-1",
  title: "Test Contract",
  status: "DRAFT",
}

const mockUserSelect = { id: "user-2", name: "Alice", email: "alice@example.com", image: null }

const mockApproval = {
  id: "approval-1",
  contractId: "contract-1",
  requestedById: "user-1",
  requestedBy: { id: "user-1", name: "Bob", email: "bob@example.com", image: null },
  assignedToId: "user-2",
  assignedTo: mockUserSelect,
  status: "pending",
  comment: null,
  decidedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const mockMember = {
  id: "member-1",
  userId: "user-2",
  organizationId: "org-1",
  role: "legal",
  createdAt: new Date(),
  user: mockUserSelect,
}

// ─── GET /api/contracts/[id]/approvals ────────────────────────────────────────

describe("GET /api/contracts/[id]/approvals", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when unauthenticated", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)

    const { GET } = await import("@/app/api/contracts/[id]/approvals/route")

    const req = new Request("http://localhost/api/contracts/contract-1/approvals")
    const res = await GET(req, { params: { id: "contract-1" } })

    expect(res.status).toBe(401)
  })

  it("returns 404 when contract belongs to another org", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      ...mockContract,
      organizationId: "org-attacker",
    } as any)

    const { GET } = await import("@/app/api/contracts/[id]/approvals/route")

    const req = new Request("http://localhost/api/contracts/contract-1/approvals")
    const res = await requestContext.run(mockCtx, () =>
      GET(req, { params: { id: "contract-1" } }),
    )

    expect(res.status).toBe(404)
  })

  it("returns approvals list", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(mockContract as any)
    vi.mocked(prisma.approval.findMany).mockResolvedValueOnce([mockApproval] as any)

    const { GET } = await import("@/app/api/contracts/[id]/approvals/route")

    const req = new Request("http://localhost/api/contracts/contract-1/approvals")
    const res = await requestContext.run(mockCtx, () =>
      GET(req, { params: { id: "contract-1" } }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.approvals)).toBe(true)
    expect(body.approvals).toHaveLength(1)
    expect(body.approvals[0].id).toBe("approval-1")
    expect(body.approvals[0].assignedTo.name).toBe("Alice")
  })
})

// ─── POST /api/contracts/[id]/approvals ──────────────────────────────────────

describe("POST /api/contracts/[id]/approvals", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when unauthenticated", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)

    const { POST } = await import("@/app/api/contracts/[id]/approvals/route")

    const req = new Request("http://localhost/api/contracts/contract-1/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedToId: "user-2" }),
    })
    const res = await POST(req, { params: { id: "contract-1" } })

    expect(res.status).toBe(401)
  })

  it("returns 403 when caller is not admin or legal", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValueOnce({
      ...mockCtx,
      role: "member",
    })

    const { POST } = await import("@/app/api/contracts/[id]/approvals/route")

    const req = new Request("http://localhost/api/contracts/contract-1/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedToId: "user-2" }),
    })
    const res = await requestContext.run({ ...mockCtx, role: "member" }, () =>
      POST(req, { params: { id: "contract-1" } }),
    )

    expect(res.status).toBe(403)
  })

  it("returns 404 when contract belongs to another org", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      ...mockContract,
      organizationId: "org-attacker",
    } as any)

    const { POST } = await import("@/app/api/contracts/[id]/approvals/route")

    const req = new Request("http://localhost/api/contracts/contract-1/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedToId: "user-2" }),
    })
    const res = await requestContext.run(mockCtx, () =>
      POST(req, { params: { id: "contract-1" } }),
    )

    expect(res.status).toBe(404)
  })

  it("creates approval and advances DRAFT contract to PENDING_APPROVAL", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(mockContract as any)
    vi.mocked(prisma.member.findFirst).mockResolvedValueOnce(mockMember as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "user-1",
      name: "Bob",
      email: "bob@example.com",
      image: null,
    } as any)
    vi.mocked(prisma.approval.create).mockResolvedValueOnce(mockApproval as any)
    vi.mocked(prisma.contract.update).mockResolvedValueOnce({
      ...mockContract,
      status: "PENDING_APPROVAL",
    } as any)

    const { POST } = await import("@/app/api/contracts/[id]/approvals/route")

    const req = new Request("http://localhost/api/contracts/contract-1/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedToId: "user-2", message: "Please review this NDA." }),
    })
    const res = await requestContext.run(mockCtx, () =>
      POST(req, { params: { id: "contract-1" } }),
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.approval.id).toBe("approval-1")
    expect(body.approval.status).toBe("pending")

    // Should have advanced contract status
    expect(prisma.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "contract-1" },
        data: { status: "PENDING_APPROVAL" },
      }),
    )
  })

  it("creates approval without advancing status when contract is already PENDING_APPROVAL", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      ...mockContract,
      status: "PENDING_APPROVAL",
    } as any)
    vi.mocked(prisma.member.findFirst).mockResolvedValueOnce(mockMember as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "user-1",
      name: "Bob",
      email: "bob@example.com",
      image: null,
    } as any)
    vi.mocked(prisma.approval.create).mockResolvedValueOnce(mockApproval as any)

    const { POST } = await import("@/app/api/contracts/[id]/approvals/route")

    const req = new Request("http://localhost/api/contracts/contract-1/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedToId: "user-2" }),
    })
    const res = await requestContext.run(mockCtx, () =>
      POST(req, { params: { id: "contract-1" } }),
    )

    expect(res.status).toBe(201)
    // Should NOT have called contract.update for status advancement
    expect(prisma.contract.update).not.toHaveBeenCalled()
  })
})

// ─── PATCH /api/contracts/[id]/approvals/[approvalId] ────────────────────────

describe("PATCH /api/contracts/[id]/approvals/[approvalId]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when unauthenticated", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)

    const { PATCH } = await import("@/app/api/contracts/[id]/approvals/[approvalId]/route")

    const req = new Request(
      "http://localhost/api/contracts/contract-1/approvals/approval-1",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approved" }),
      },
    )
    const res = await PATCH(req, { params: { id: "contract-1", approvalId: "approval-1" } })

    expect(res.status).toBe(401)
  })

  it("returns 403 when caller is not the assignee", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(mockContract as any)
    vi.mocked(prisma.approval.findUnique).mockResolvedValueOnce({
      ...mockApproval,
      assignedToId: "user-someone-else",
    } as any)

    const { PATCH } = await import("@/app/api/contracts/[id]/approvals/[approvalId]/route")

    const req = new Request(
      "http://localhost/api/contracts/contract-1/approvals/approval-1",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approved" }),
      },
    )
    const res = await requestContext.run(mockCtx, () =>
      PATCH(req, { params: { id: "contract-1", approvalId: "approval-1" } }),
    )

    expect(res.status).toBe(403)
  })

  it("returns 404 when approval belongs to a different contract", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(mockContract as any)
    vi.mocked(prisma.approval.findUnique).mockResolvedValueOnce({
      ...mockApproval,
      contractId: "contract-different",
    } as any)

    const { PATCH } = await import("@/app/api/contracts/[id]/approvals/[approvalId]/route")

    const req = new Request(
      "http://localhost/api/contracts/contract-1/approvals/approval-1",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approved" }),
      },
    )
    const res = await requestContext.run(mockCtx, () =>
      PATCH(req, { params: { id: "contract-1", approvalId: "approval-1" } }),
    )

    expect(res.status).toBe(404)
  })

  it("approves an approval and writes APPROVED activity", async () => {
    const { writeActivity } = await import("@/lib/db/activity")

    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(mockContract as any)
    vi.mocked(prisma.approval.findUnique).mockResolvedValueOnce({
      ...mockApproval,
      assignedToId: "user-1", // matches mockCtx.userId
    } as any)
    vi.mocked(prisma.approval.update).mockResolvedValueOnce({
      ...mockApproval,
      status: "approved",
      decidedAt: new Date(),
    } as any)

    const { PATCH } = await import("@/app/api/contracts/[id]/approvals/[approvalId]/route")

    const req = new Request(
      "http://localhost/api/contracts/contract-1/approvals/approval-1",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approved", comment: "Looks good." }),
      },
    )
    const res = await requestContext.run(mockCtx, () =>
      PATCH(req, { params: { id: "contract-1", approvalId: "approval-1" } }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.approval.status).toBe("approved")

    expect(prisma.approval.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "approval-1" },
        data: expect.objectContaining({
          status: "approved",
          comment: "Looks good.",
          decidedAt: expect.any(Date),
        }),
      }),
    )
    expect(writeActivity).toHaveBeenCalledWith(
      "contract-1",
      "user-1",
      "APPROVED",
      expect.stringContaining("Looks good."),
    )
  })

  it("advances to AWAITING_SIGNATURE only after all approvals are approved", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      ...mockContract,
      status: "PENDING_APPROVAL",
    } as any)
    vi.mocked(prisma.approval.findUnique).mockResolvedValueOnce({
      ...mockApproval,
      assignedToId: "user-1",
      required: true,
    } as any)
    vi.mocked(prisma.approval.update).mockResolvedValueOnce({
      ...mockApproval,
      status: "approved",
      decidedAt: new Date(),
    } as any)
    vi.mocked(prisma.approval.findFirst).mockResolvedValueOnce(null) // no next waiting
    vi.mocked(prisma.approval.findMany).mockResolvedValueOnce([]) // no unresolved required
    vi.mocked(prisma.approval.count).mockResolvedValueOnce(1) // 1 required approval exists

    const { PATCH } = await import("@/app/api/contracts/[id]/approvals/[approvalId]/route")

    const req = new Request(
      "http://localhost/api/contracts/contract-1/approvals/approval-1",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approved" }),
      },
    )
    const res = await requestContext.run(mockCtx, () =>
      PATCH(req, { params: { id: "contract-1", approvalId: "approval-1" } }),
    )

    expect(res.status).toBe(200)
    expect(prisma.contract.update).toHaveBeenCalledWith({
      where: { id: "contract-1", status: "PENDING_APPROVAL" },
      data: { status: "AWAITING_SIGNATURE" },
    })
  })

  it("keeps contract in PENDING_APPROVAL while other approvals remain unresolved", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      ...mockContract,
      status: "PENDING_APPROVAL",
    } as any)
    vi.mocked(prisma.approval.findUnique).mockResolvedValueOnce({
      ...mockApproval,
      assignedToId: "user-1",
      required: true,
    } as any)
    vi.mocked(prisma.approval.update).mockResolvedValueOnce({
      ...mockApproval,
      status: "approved",
      decidedAt: new Date(),
    } as any)
    vi.mocked(prisma.approval.findFirst).mockResolvedValueOnce(null) // no next waiting
    vi.mocked(prisma.approval.findMany).mockResolvedValueOnce([{ id: "approval-2" }] as any) // still unresolved

    const { PATCH } = await import("@/app/api/contracts/[id]/approvals/[approvalId]/route")

    const req = new Request(
      "http://localhost/api/contracts/contract-1/approvals/approval-1",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approved" }),
      },
    )
    const res = await requestContext.run(mockCtx, () =>
      PATCH(req, { params: { id: "contract-1", approvalId: "approval-1" } }),
    )

    expect(res.status).toBe(200)
    expect(prisma.contract.update).not.toHaveBeenCalled()
  })

  it("rejects an approval and writes REJECTED activity", async () => {
    const { writeActivity } = await import("@/lib/db/activity")

    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(mockContract as any)
    vi.mocked(prisma.approval.findUnique).mockResolvedValueOnce({
      ...mockApproval,
      assignedToId: "user-1",
    } as any)
    vi.mocked(prisma.approval.update).mockResolvedValueOnce({
      ...mockApproval,
      status: "rejected",
      comment: "Missing clause 4.",
      decidedAt: new Date(),
    } as any)

    const { PATCH } = await import("@/app/api/contracts/[id]/approvals/[approvalId]/route")

    const req = new Request(
      "http://localhost/api/contracts/contract-1/approvals/approval-1",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "rejected", comment: "Missing clause 4." }),
      },
    )
    const res = await requestContext.run(mockCtx, () =>
      PATCH(req, { params: { id: "contract-1", approvalId: "approval-1" } }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.approval.status).toBe("rejected")

    expect(writeActivity).toHaveBeenCalledWith(
      "contract-1",
      "user-1",
      "REJECTED",
      expect.stringContaining("Missing clause 4."),
    )
  })

  it("moves a rejected pending-approval contract back to internal review", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      ...mockContract,
      status: "PENDING_APPROVAL",
    } as any)
    vi.mocked(prisma.approval.findUnique).mockResolvedValueOnce({
      ...mockApproval,
      assignedToId: "user-1",
      required: true,
    } as any)
    vi.mocked(prisma.approval.update).mockResolvedValueOnce({
      ...mockApproval,
      status: "rejected",
      decidedAt: new Date(),
    } as any)

    const { PATCH } = await import("@/app/api/contracts/[id]/approvals/[approvalId]/route")

    const req = new Request(
      "http://localhost/api/contracts/contract-1/approvals/approval-1",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "rejected" }),
      },
    )
    const res = await requestContext.run(mockCtx, () =>
      PATCH(req, { params: { id: "contract-1", approvalId: "approval-1" } }),
    )

    expect(res.status).toBe(200)
    expect(prisma.contract.update).toHaveBeenCalledWith({
      where: { id: "contract-1", status: "PENDING_APPROVAL" },
      data: { status: "INTERNAL_REVIEW" },
    })
  })
})

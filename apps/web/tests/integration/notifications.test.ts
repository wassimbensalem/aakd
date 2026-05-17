/**
 * Notification delivery tests.
 *
 * These tests verify that in-app Notification rows are written directly from
 * API routes — not through the BullMQ worker — so delivery is guaranteed
 * regardless of whether the worker process is running.
 *
 * What we test:
 *  1. approval.requested  → assignee gets a notification
 *  2. approval.approved   → requester gets a notification
 *  3. approval.rejected   → requester gets a notification
 *  4. GET /api/notifications → returns rows for current org + org.invited events
 *  5. org.invited cross-org → notification surfaces when invitee checks their own org
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prisma } from "@/lib/db/client"
import { requestContext } from "@/lib/context"

// ─── Shared mock context ──────────────────────────────────────────────────────

const mockCtx = {
  userId: "user-admin",
  organizationId: "org-1",
  role: "admin",
  source: "session" as const,
  requestId: "req-test",
}

vi.mock("@/lib/auth/middleware", () => ({
  resolveAuth: vi.fn().mockResolvedValue(mockCtx),
  requireWriteScope: vi.fn(() => null),
}))
vi.mock("@/lib/db/activity", () => ({
  writeActivity: vi.fn().mockResolvedValue(undefined),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockContract = {
  id: "contract-1",
  title: "Supplier NDA",
  organizationId: "org-1",
  status: "DRAFT",
}

const mockAssignee = { id: "user-reviewer", name: "Alice", email: "alice@test.com", image: null }
const mockRequester = { id: "user-admin", name: "Bob", email: "bob@test.com", image: null }

const mockApproval = {
  id: "approval-1",
  contractId: "contract-1",
  requestedById: "user-admin",
  requestedBy: mockRequester,
  assignedToId: "user-reviewer",
  assignedTo: mockAssignee,
  status: "pending",
  comment: null,
  decidedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const mockMember = {
  id: "member-1",
  userId: "user-reviewer",
  organizationId: "org-1",
  role: "legal",
  createdAt: new Date(),
  user: mockAssignee,
}

// ─── 1. approval.requested → assignee receives in-app notification ─────────────

describe("notification: approval.requested", () => {
  beforeEach(() => vi.clearAllMocks())

  it("writes a Notification row for the assignee when an approval is created", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(mockContract as any)
    vi.mocked(prisma.member.findFirst).mockResolvedValueOnce(mockMember as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockRequester as any)
    vi.mocked(prisma.approval.create).mockResolvedValueOnce(mockApproval as any)
    vi.mocked(prisma.notification.create).mockResolvedValueOnce({ id: "notif-1" } as any)

    const { POST } = await import("@/app/api/contracts/[id]/approvals/route")
    const req = new Request("http://localhost/api/contracts/contract-1/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedToId: "user-reviewer" }),
    })
    const res = await requestContext.run(mockCtx, () => POST(req, { params: { id: "contract-1" } }))

    expect(res.status).toBe(201)

    // Notification.create must have been called for the assignee
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-reviewer",
          organizationId: "org-1",
          contractId: "contract-1",
          eventName: "approval.requested",
          title: "Approval requested",
        }),
      }),
    )
  })

  it("does NOT write a notification when the status is waiting (inactive in chain)", async () => {
    // Simulate a chain where step 1 is already active: count=1 pending required
    // → nextStep becomes 2 → approvalStatus becomes "waiting" → no notification
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      ...mockContract,
      status: "PENDING_APPROVAL",
    } as any)
    vi.mocked(prisma.approval.findFirst).mockResolvedValueOnce(null) // no duplicate
    vi.mocked(prisma.member.findFirst).mockResolvedValueOnce(mockMember as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockRequester as any)
    vi.mocked(prisma.approval.count).mockResolvedValueOnce(1) // 1 active pending → hasActivePending=true
    vi.mocked(prisma.approval.aggregate).mockResolvedValueOnce({ _max: { step: 1 } } as any) // current max step = 1
    vi.mocked(prisma.approval.create).mockResolvedValueOnce({
      ...mockApproval,
      status: "waiting",
    } as any)

    const { POST } = await import("@/app/api/contracts/[id]/approvals/route")
    const req = new Request("http://localhost/api/contracts/contract-1/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedToId: "user-reviewer", required: true }),
    })
    await requestContext.run(mockCtx, () => POST(req, { params: { id: "contract-1" } }))

    // notification.create should NOT be called for a waiting approval
    const notifCalls = vi.mocked(prisma.notification.create).mock.calls
    const approvalNotifs = notifCalls.filter(
      (c) => (c[0] as any)?.data?.eventName === "approval.requested",
    )
    expect(approvalNotifs).toHaveLength(0)
  })
})

// ─── 2. approval.approved → requester receives in-app notification ─────────────

describe("notification: approval.approved", () => {
  beforeEach(() => vi.clearAllMocks())

  it("writes a Notification row for the requester when approved", async () => {
    vi.mocked(prisma.contract.findUnique)
      .mockResolvedValueOnce(mockContract as any)   // route auth guard
      .mockResolvedValueOnce({ title: "Supplier NDA" } as any) // contractForNotif

    vi.mocked(prisma.approval.findUnique).mockResolvedValueOnce({
      ...mockApproval,
      assignedToId: "user-admin", // caller is the assignee
    } as any)

    vi.mocked(prisma.approval.update).mockResolvedValueOnce({
      ...mockApproval,
      status: "approved",
      decidedAt: new Date(),
    } as any)

    // No next waiting, no unresolved required
    vi.mocked(prisma.approval.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.approval.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.approval.count).mockResolvedValueOnce(1)

    vi.mocked(prisma.notification.create).mockResolvedValue({ id: "notif-2" } as any)

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

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-admin", // the requester
          organizationId: "org-1",
          contractId: "contract-1",
          eventName: "approval.approved",
          title: "Approval approved",
        }),
      }),
    )
  })
})

// ─── 3. approval.rejected → requester receives in-app notification ─────────────

describe("notification: approval.rejected", () => {
  beforeEach(() => vi.clearAllMocks())

  it("writes a Notification row for the requester when rejected", async () => {
    vi.mocked(prisma.contract.findUnique)
      .mockResolvedValueOnce(mockContract as any)
      .mockResolvedValueOnce({ title: "Supplier NDA" } as any)

    vi.mocked(prisma.approval.findUnique).mockResolvedValueOnce({
      ...mockApproval,
      assignedToId: "user-admin",
    } as any)
    vi.mocked(prisma.approval.update).mockResolvedValueOnce({
      ...mockApproval,
      status: "rejected",
      decidedAt: new Date(),
    } as any)

    vi.mocked(prisma.notification.create).mockResolvedValue({ id: "notif-3" } as any)

    const { PATCH } = await import("@/app/api/contracts/[id]/approvals/[approvalId]/route")
    const req = new Request(
      "http://localhost/api/contracts/contract-1/approvals/approval-1",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "rejected", comment: "Missing clause." }),
      },
    )
    const res = await requestContext.run(mockCtx, () =>
      PATCH(req, { params: { id: "contract-1", approvalId: "approval-1" } }),
    )

    expect(res.status).toBe(200)

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-admin",
          organizationId: "org-1",
          contractId: "contract-1",
          eventName: "approval.rejected",
          title: "Approval rejected",
        }),
      }),
    )
  })
})

// ─── 4. GET /api/notifications — correct rows returned ───────────────────────

describe("GET /api/notifications", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns notifications and unread count", async () => {
    const mockNotifications = [
      {
        id: "notif-1",
        contractId: "contract-1",
        eventName: "approval.requested",
        title: "Approval requested",
        body: "Bob asked you to approve",
        read: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      },
    ]

    vi.mocked(prisma.notification.findMany).mockResolvedValueOnce(mockNotifications as any)
    vi.mocked(prisma.notification.count).mockResolvedValueOnce(1)

    const { GET } = await import("@/app/api/notifications/route")
    const req = new Request("http://localhost/api/notifications")
    const res = await requestContext.run(mockCtx, () => GET(req))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.notifications).toHaveLength(1)
    expect(body.notifications[0].eventName).toBe("approval.requested")
    expect(body.unreadCount).toBe(1)
  })

  it("queries with OR clause to include org.invited cross-org events", async () => {
    vi.mocked(prisma.notification.findMany).mockResolvedValueOnce([])
    vi.mocked(prisma.notification.count).mockResolvedValueOnce(0)

    const { GET } = await import("@/app/api/notifications/route")
    const req = new Request("http://localhost/api/notifications")
    await requestContext.run(mockCtx, () => GET(req))

    const findManyCall = vi.mocked(prisma.notification.findMany).mock.calls[0][0] as any
    expect(findManyCall.where).toMatchObject({
      userId: "user-admin",
      OR: expect.arrayContaining([
        { organizationId: "org-1" },
        { eventName: "org.invited" },
      ]),
    })
  })
})

// ─── 5. org.invited cross-org notification ────────────────────────────────────

describe("notification: org.invited", () => {
  beforeEach(() => vi.clearAllMocks())

  it("writes a Notification row for the invitee when they already have an account", async () => {
    vi.mocked(prisma.invitation.findFirst).mockResolvedValueOnce(null) // no existing pending invite
    vi.mocked(prisma.member.findFirst).mockResolvedValueOnce(null)    // not already a member
    vi.mocked(prisma.invitation.create).mockResolvedValueOnce({
      id: "inv-abc",
      email: "newuser@test.com",
      role: "member",
      organizationId: "org-1",
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000 * 30),
      inviterId: "user-admin",
    } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValueOnce({ name: "Acme Corp" } as any)
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ name: "Bob", email: "bob@test.com" } as any) // inviter
      .mockResolvedValueOnce({ id: "user-existing" } as any)               // invitee already has account

    vi.mocked(prisma.notification.create).mockResolvedValueOnce({ id: "notif-invite" } as any)

    const { POST } = await import("@/app/api/org/members/invite/route")
    const req = new Request("http://localhost/api/org/members/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "newuser@test.com", role: "member" }),
    })
    const res = await requestContext.run(mockCtx, () => POST(req))

    expect(res.status).toBe(201)

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-existing",
          organizationId: "org-1",
          eventName: "org.invited",
          title: "You've been invited",
        }),
      }),
    )
  })

  it("does NOT write a Notification row when the invitee has no existing account", async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.invitation.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.invitation.create).mockResolvedValueOnce({
      id: "inv-xyz",
      email: "brand-new@test.com",
      role: "member",
      organizationId: "org-1",
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000 * 30),
      inviterId: "user-admin",
    } as any)
    vi.mocked(prisma.organization.findUnique).mockResolvedValueOnce({ name: "Acme Corp" } as any)
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ name: "Bob", email: "bob@test.com" } as any) // inviter
      .mockResolvedValueOnce(null) // invitee does NOT have an account

    const { POST } = await import("@/app/api/org/members/invite/route")
    const req = new Request("http://localhost/api/org/members/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "brand-new@test.com", role: "member" }),
    })
    await requestContext.run(mockCtx, () => POST(req))

    const notifCalls = vi.mocked(prisma.notification.create).mock.calls
    const inviteNotifs = notifCalls.filter(
      (c) => (c[0] as any)?.data?.eventName === "org.invited",
    )
    expect(inviteNotifs).toHaveLength(0)
  })
})

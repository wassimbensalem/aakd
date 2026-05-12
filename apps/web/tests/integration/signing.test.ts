import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createHmac } from "crypto"
import { prisma } from "@/lib/db/client"
import { requestContext } from "@/lib/context"

// ─── Webhook test helpers ──────────────────────────────────────────────────────

const TEST_WEBHOOK_SECRET = "test-signing-webhook-secret-123"

function makeSignedWebhookRequest(body: object): Request {
  const rawBody = JSON.stringify(body)
  const sig = createHmac("sha256", TEST_WEBHOOK_SECRET).update(rawBody).digest("hex")
  return new Request("http://localhost/api/webhooks/docuseal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-docuseal-signature": sig,
    },
    body: rawBody,
  })
}

// ─── Mock auth ────────────────────────────────────────────────────────────────

const mockCtx = {
  userId: "user-1",
  organizationId: "org-1",
  role: "admin",
  source: "session" as const,
}

vi.mock("@/lib/auth/middleware", () => ({
  resolveAuth: vi.fn(),
  requireWriteScope: vi.fn(() => null),
}))

vi.mock("@/lib/db/activity", () => ({
  writeActivity: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/storage", () => ({
  storage: {
    getSignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.example.com/file.pdf"),
    upload: vi.fn().mockResolvedValue("orgs/org-1/contracts/contract-1/123_signed.pdf"),
    storageKey: vi.fn(
      (orgId: string, contractId: string, filename: string) =>
        `orgs/${orgId}/contracts/${contractId}/${Date.now()}_${filename}`,
    ),
  },
}))

vi.mock("@/lib/docuseal", () => ({
  createTemplate: vi.fn().mockResolvedValue({ id: 42, attachmentUuid: null }),
  createSubmission: vi.fn().mockResolvedValue({
    id: 99,
    submitters: [{ slug: "abc123", embed_src: "https://docuseal.com/s/abc123" }],
  }),
  // Stubbed to allow webhook-supplied URLs through; real impl checks the host
  // against DOCUSEAL_API_URL (covered separately by lib/docuseal tests).
  isAllowedDocuSealUrl: vi.fn().mockReturnValue(true),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockContract = {
  id: "contract-1",
  organizationId: "org-1",
  title: "Test NDA",
  status: "AWAITING_SIGNATURE",
  counterpartyName: "Acme Corp",
  counterpartyContact: "acme@example.com",
  ownerId: "user-1",
}

const mockFile = {
  id: "file-1",
  contractId: "contract-1",
  filename: "test.pdf",
  storageKey: "orgs/org-1/contracts/contract-1/test.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1024,
  isSigned: false,
  isLatest: true,
  version: 1,
  uploadedById: "user-1",
  createdAt: new Date(),
}

// ─── POST /api/contracts/[id]/sign ────────────────────────────────────────────

describe("POST /api/contracts/[id]/sign", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Restore default resolveAuth mock after clearAllMocks resets it
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(mockCtx)
  })

  it("returns 401 when unauthenticated", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)

    const { POST } = await import("@/app/api/contracts/[id]/sign/route")

    const req = new Request("http://localhost/api/contracts/contract-1/sign", {
      method: "POST",
    })
    const res = await POST(req, { params: { id: "contract-1" } })

    expect(res.status).toBe(401)
  })

  it("returns 404 when contract belongs to another org", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      ...mockContract,
      organizationId: "org-attacker",
    } as any)

    const { POST } = await import("@/app/api/contracts/[id]/sign/route")

    const req = new Request("http://localhost/api/contracts/contract-1/sign", {
      method: "POST",
    })
    const res = await requestContext.run(mockCtx, () =>
      POST(req, { params: { id: "contract-1" } }),
    )

    expect(res.status).toBe(404)
  })

  it("returns 400 when status is not AWAITING_SIGNATURE", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      ...mockContract,
      status: "DRAFT",
    } as any)

    const { POST } = await import("@/app/api/contracts/[id]/sign/route")

    const req = new Request("http://localhost/api/contracts/contract-1/sign", {
      method: "POST",
    })
    const res = await requestContext.run(mockCtx, () =>
      POST(req, { params: { id: "contract-1" } }),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Contract must be in AWAITING_SIGNATURE status")
  })

  it("returns 503 when DOCUSEAL_API_KEY is not set", async () => {
    const originalKey = process.env.DOCUSEAL_API_KEY
    delete process.env.DOCUSEAL_API_KEY

    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(mockContract as any)

    const { POST } = await import("@/app/api/contracts/[id]/sign/route")

    const req = new Request("http://localhost/api/contracts/contract-1/sign", {
      method: "POST",
    })
    const res = await requestContext.run(mockCtx, () =>
      POST(req, { params: { id: "contract-1" } }),
    )

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe("E-signature not configured")

    // Restore
    if (originalKey !== undefined) process.env.DOCUSEAL_API_KEY = originalKey
  })

  it("returns 400 when contract has no files", async () => {
    process.env.DOCUSEAL_API_KEY = "test-key"

    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(mockContract as any)
    vi.mocked(prisma.contractFile.findFirst).mockResolvedValueOnce(null)

    const { POST } = await import("@/app/api/contracts/[id]/sign/route")

    const req = new Request("http://localhost/api/contracts/contract-1/sign", {
      method: "POST",
    })
    const res = await requestContext.run(mockCtx, () =>
      POST(req, { params: { id: "contract-1" } }),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("No file attached to this contract")
  })

  it("triggers signing and returns submissionId + signingUrl on success", async () => {
    process.env.DOCUSEAL_API_KEY = "test-key"

    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(mockContract as any)
    vi.mocked(prisma.contractFile.findFirst).mockResolvedValueOnce(mockFile as any)
    vi.mocked(prisma.contract.update).mockResolvedValueOnce({
      ...mockContract,
      docusealSubmissionId: "99",
      signingUrl: "https://docuseal.com/s/abc123",
      signingStatus: "sent",
    } as any)

    // Mock the fetch for file download
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    } as any)

    const { createTemplate, createSubmission } = await import("@/lib/docuseal")
    vi.mocked(createTemplate).mockResolvedValueOnce({ id: 42, attachmentUuid: null })
    vi.mocked(createSubmission).mockResolvedValueOnce({
      id: 99,
      submitters: [{ slug: "abc123", embed_src: "https://docuseal.com/s/abc123" }],
    })

    const { POST } = await import("@/app/api/contracts/[id]/sign/route")
    const { writeActivity } = await import("@/lib/db/activity")

    const req = new Request("http://localhost/api/contracts/contract-1/sign", {
      method: "POST",
    })
    const res = await requestContext.run(mockCtx, () =>
      POST(req, { params: { id: "contract-1" } }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.submissionId).toBe(99)
    expect(body.signingUrl).toBe("https://docuseal.com/s/abc123")
    expect(body.signingStatus).toBe("sent")

    expect(prisma.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "contract-1" },
        data: expect.objectContaining({
          docusealSubmissionId: "99",
          signingUrl: "https://docuseal.com/s/abc123",
          signingStatus: "sent",
        }),
      }),
    )

    expect(writeActivity).toHaveBeenCalledWith(
      "contract-1",
      "user-1",
      "SENT_FOR_SIGNATURE",
      expect.stringContaining("acme@example.com"),
    )
  })
})

// ─── POST /api/webhooks/docuseal ──────────────────────────────────────────────

describe("POST /api/webhooks/docuseal", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Set the webhook secret so verifySignature() doesn't reject all calls.
    // Do NOT call vi.resetModules() here — it breaks the prisma mock setup
    // that all tests in this suite share.
    process.env.DOCUSEAL_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValue(mockCtx)
  })

  afterEach(() => {
    delete process.env.DOCUSEAL_WEBHOOK_SECRET
  })

  it("ignores non-form.completed events and returns 200", async () => {
    const { POST } = await import("@/app/api/webhooks/docuseal/route")

    const req = makeSignedWebhookRequest({
      event_type: "form.viewed",
      data: { id: 99, status: "in_progress", documents: [] },
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    // Should NOT have queried the database at all
    expect(prisma.contract.findFirst).not.toHaveBeenCalled()
  })

  it("returns 200 when submission contract is not found (prevent DocuSeal retries)", async () => {
    vi.mocked(prisma.contract.findFirst).mockResolvedValueOnce(null)

    const { POST } = await import("@/app/api/webhooks/docuseal/route")

    const req = makeSignedWebhookRequest({
      event_type: "form.completed",
      data: { id: 999, status: "completed", documents: [{ url: "https://docs.example.com/signed.pdf" }] },
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it("processes form.completed: downloads, re-uploads, marks ACTIVE, writes activity", async () => {
    const mockFoundContract = {
      id: "contract-1",
      organizationId: "org-1",
      ownerId: "user-1",
    }

    vi.mocked(prisma.contract.findFirst).mockResolvedValueOnce(mockFoundContract as any)

    const existingLatestFile = { id: "file-1", version: 2 }
    vi.mocked(prisma.contractFile.findFirst).mockResolvedValueOnce(existingLatestFile as any)

    vi.mocked(prisma.$transaction).mockResolvedValueOnce([undefined, undefined, undefined] as any)

    const { storage } = await import("@/lib/storage")

    // Mock fetch for downloading signed PDF
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(512),
    } as any)

    const { POST } = await import("@/app/api/webhooks/docuseal/route")
    const { writeActivity } = await import("@/lib/db/activity")

    const req = makeSignedWebhookRequest({
      event_type: "form.completed",
      data: {
        id: 99,
        status: "completed",
        documents: [{ url: "https://docuseal.com/signed.pdf" }],
      },
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    // Should have uploaded the signed PDF to S3 under the org-scoped key
    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringMatching(/orgs\/org-1\/contracts\/contract-1\/.*signed_.*\.pdf/),
      expect.any(Buffer),
      "application/pdf",
    )

    // Should have run a transaction
    expect(prisma.$transaction).toHaveBeenCalled()
    expect(prisma.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "contract-1", organizationId: "org-1" },
        data: expect.objectContaining({
          status: "ACTIVE",
          signingStatus: "completed",
          signingUrl: null,
        }),
      }),
    )

    // Should have written SIGNED activity
    expect(writeActivity).toHaveBeenCalledWith(
      "contract-1",
      null,
      "SIGNED",
      expect.stringContaining("99"),
    )
  })

  it("records terminal non-completed signing states without downloading a PDF", async () => {
    const mockFoundContract = {
      id: "contract-1",
      organizationId: "org-1",
      ownerId: "user-1",
    }

    vi.mocked(prisma.contract.findFirst).mockResolvedValueOnce(mockFoundContract as any)
    vi.mocked(prisma.contract.update).mockResolvedValueOnce({
      ...mockFoundContract,
      signingStatus: "declined",
    } as any)
    global.fetch = vi.fn()

    const { POST } = await import("@/app/api/webhooks/docuseal/route")
    const { writeActivity } = await import("@/lib/db/activity")

    const req = makeSignedWebhookRequest({
      event_type: "form.declined",
      data: { id: 99, status: "declined", documents: [] },
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(prisma.contract.update).toHaveBeenCalledWith({
      where: { id: "contract-1", organizationId: "org-1" },
      data: { signingStatus: "declined" },
    })
    expect(writeActivity).toHaveBeenCalledWith(
      "contract-1",
      null,
      "UPDATED",
      expect.stringContaining("declined"),
    )
  })
})

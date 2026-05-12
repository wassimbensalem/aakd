import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createHmac } from "crypto"
import { prisma } from "@/lib/db/client"

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/middleware", () => ({
  resolveAuth: vi.fn(),
  requireWriteScope: vi.fn(() => null),
}))

vi.mock("@/lib/db/activity", () => ({
  writeActivity: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/storage", () => ({
  storage: {
    upload: vi.fn().mockResolvedValue("contracts/c1/signed_123.pdf"),
  },
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWebhookRequest(
  body: object,
  signatureHeader: string | null = null,
): Request {
  const rawBody = JSON.stringify(body)
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (signatureHeader !== null) {
    headers["x-docuseal-signature"] = signatureHeader
  }
  return new Request("http://localhost/api/webhooks/docuseal", {
    method: "POST",
    headers,
    body: rawBody,
  })
}

function sign(secret: string, body: object): string {
  return createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex")
}

const ignoredPayload = {
  event_type: "form.viewed",
  data: { id: 1, status: "in_progress", documents: [] },
}

// ─── HMAC signature verification ─────────────────────────────────────────────

describe("DocuSeal webhook HMAC verification", () => {
  const SECRET = "test-webhook-secret-abc123"

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  afterEach(() => {
    delete process.env.DOCUSEAL_WEBHOOK_SECRET
  })

  it("returns 403 when no secret is configured (fail-secure — reject forged events)", async () => {
    delete process.env.DOCUSEAL_WEBHOOK_SECRET

    const { POST } = await import("@/app/api/webhooks/docuseal/route")
    // No signature header and no secret — must be rejected to prevent forged webhook acceptance
    const req = makeWebhookRequest(ignoredPayload, null)
    const res = await POST(req)

    expect(res.status).toBe(403)
  })

  it("returns 200 for a valid HMAC-SHA256 signature", async () => {
    process.env.DOCUSEAL_WEBHOOK_SECRET = SECRET

    const { POST } = await import("@/app/api/webhooks/docuseal/route")
    const sig = sign(SECRET, ignoredPayload)
    const req = makeWebhookRequest(ignoredPayload, sig)
    const res = await POST(req)

    expect(res.status).toBe(200)
  })

  it("returns 200 for a valid signature in sha256=<hex> format", async () => {
    process.env.DOCUSEAL_WEBHOOK_SECRET = SECRET

    const { POST } = await import("@/app/api/webhooks/docuseal/route")
    const sig = `sha256=${sign(SECRET, ignoredPayload)}`
    const req = makeWebhookRequest(ignoredPayload, sig)
    const res = await POST(req)

    expect(res.status).toBe(200)
  })

  it("returns 403 when secret is configured but signature header is missing", async () => {
    process.env.DOCUSEAL_WEBHOOK_SECRET = SECRET

    const { POST } = await import("@/app/api/webhooks/docuseal/route")
    const req = makeWebhookRequest(ignoredPayload, null)
    const res = await POST(req)

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("Invalid or missing signature")
  })

  it("returns 403 when signature is wrong", async () => {
    process.env.DOCUSEAL_WEBHOOK_SECRET = SECRET

    const { POST } = await import("@/app/api/webhooks/docuseal/route")
    const req = makeWebhookRequest(ignoredPayload, "deadbeefdeadbeef")
    const res = await POST(req)

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("Invalid or missing signature")
  })

  it("returns 403 when signature matches a different secret", async () => {
    process.env.DOCUSEAL_WEBHOOK_SECRET = SECRET

    const { POST } = await import("@/app/api/webhooks/docuseal/route")
    const wrongSig = sign("wrong-secret", ignoredPayload)
    const req = makeWebhookRequest(ignoredPayload, wrongSig)
    const res = await POST(req)

    expect(res.status).toBe(403)
  })

  it("returns 403 when body is tampered after signing", async () => {
    process.env.DOCUSEAL_WEBHOOK_SECRET = SECRET

    const { POST } = await import("@/app/api/webhooks/docuseal/route")

    // Sign original payload but send different body
    const originalPayload = { event_type: "form.viewed", data: { id: 1, status: "original", documents: [] } }
    const sig = sign(SECRET, originalPayload)

    // Tampered body
    const tamperedBody = JSON.stringify({
      event_type: "form.completed",
      data: { id: 999, status: "tampered", documents: [] },
    })
    const req = new Request("http://localhost/api/webhooks/docuseal", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-docuseal-signature": sig },
      body: tamperedBody,
    })
    const res = await POST(req)

    expect(res.status).toBe(403)
  })
})

// ─── Webhook processing with valid signature ─────────────────────────────────

const PROCESSING_SECRET = "test-processing-secret-xyz"

function makeSignedRequest(body: object | string): Request {
  const rawBody = typeof body === "string" ? body : JSON.stringify(body)
  const sig = createHmac("sha256", PROCESSING_SECRET).update(rawBody).digest("hex")
  return new Request("http://localhost/api/webhooks/docuseal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-docuseal-signature": sig,
    },
    body: rawBody,
  })
}

describe("DocuSeal webhook processing (valid requests)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env.DOCUSEAL_WEBHOOK_SECRET = PROCESSING_SECRET
  })

  afterEach(() => {
    delete process.env.DOCUSEAL_WEBHOOK_SECRET
  })

  it("returns 400 for invalid JSON body", async () => {
    const { POST } = await import("@/app/api/webhooks/docuseal/route")

    const req = makeSignedRequest("not-valid-json{")
    const res = await POST(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Invalid JSON")
  })

  it("returns 200 (ok: true) for non-form.completed events without hitting DB", async () => {
    const { POST } = await import("@/app/api/webhooks/docuseal/route")

    const req = makeSignedRequest({
      event_type: "form.started",
      data: { id: 10, status: "in_progress", documents: [] },
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(prisma.contract.findFirst).not.toHaveBeenCalled()
  })

  it("returns 200 for form.completed when contract not found (stop DocuSeal retries)", async () => {
    vi.mocked(prisma.contract.findFirst).mockResolvedValueOnce(null)

    const { POST } = await import("@/app/api/webhooks/docuseal/route")

    const req = makeSignedRequest({
      event_type: "form.completed",
      data: { id: 42, status: "completed", documents: [{ url: "https://docs.example.com/1.pdf" }] },
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})

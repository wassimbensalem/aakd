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
  requireWriteScope: vi.fn(() => null),
}))

vi.mock("@/lib/embedding", () => ({
  generateEmbedding: vi.fn(),
}))

// ─── /api/search/semantic ──────────────────────────────────────────────────────

describe("POST /api/search/semantic", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when unauthenticated", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)

    const { POST } = await import("@/app/api/search/semantic/route")

    const req = new Request("http://localhost/api/search/semantic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "indemnification clause" }),
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it("returns 503 when no embedding provider is configured", async () => {
    const { generateEmbedding } = await import("@/lib/embedding")
    vi.mocked(generateEmbedding).mockResolvedValueOnce(null)

    const { POST } = await import("@/app/api/search/semantic/route")

    const req = new Request("http://localhost/api/search/semantic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "indemnification clause" }),
    })

    const res = await POST(req)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe("Embedding provider not configured")
  })

  it("returns results when embedding provider is configured", async () => {
    const fakeEmbedding = Array.from({ length: 1536 }, (_, i) => i / 1536)

    const { generateEmbedding } = await import("@/lib/embedding")
    vi.mocked(generateEmbedding).mockResolvedValueOnce(fakeEmbedding)

    const mockRows = [
      {
        id: "contract-1",
        title: "NDA with Acme Corp",
        contractType: "NDA",
        status: "ACTIVE",
        counterpartyName: "Acme Corp",
        value: null,
        currency: "USD",
        endDate: null,
        createdAt: new Date("2026-01-01"),
        similarity: 0.87,
      },
    ]
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce(mockRows as any)

    const { POST } = await import("@/app/api/search/semantic/route")

    const req = new Request("http://localhost/api/search/semantic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "confidentiality agreement", limit: 5 }),
    })

    const res = await requestContext.run(mockCtx, () => POST(req))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.results).toHaveLength(1)
    expect(body.results[0].id).toBe("contract-1")
    expect(body.total).toBe(1)
  })

  it("returns 400 for empty query", async () => {
    const { POST } = await import("@/app/api/search/semantic/route")

    const req = new Request("http://localhost/api/search/semantic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "" }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

// ─── /api/contracts/[id]/ask ───────────────────────────────────────────────────

describe("POST /api/contracts/[id]/ask", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Ensure env vars are unset for isolation
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
  })

  it("returns 401 when unauthenticated", async () => {
    const { resolveAuth } = await import("@/lib/auth/middleware")
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)

    const { POST } = await import("@/app/api/contracts/[id]/ask/route")

    const req = new Request("http://localhost/api/contracts/c1/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "What is the notice period?" }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: "c1" }) })
    expect(res.status).toBe(401)
  })

  it("returns 400 when contract has no extracted text", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      id: "c1",
      title: "Test Contract",
      extractedText: null,
      organizationId: "org-1",
    } as any)

    const { POST } = await import("@/app/api/contracts/[id]/ask/route")

    const req = new Request("http://localhost/api/contracts/c1/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "What is the notice period?" }),
    })

    const res = await requestContext.run(mockCtx, () =>
      POST(req, { params: Promise.resolve({ id: "c1" }) }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("No extracted text available for this contract")
  })

  it("returns 404 for cross-org contract access", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      id: "c1",
      title: "Other Org Contract",
      extractedText: "Some text",
      organizationId: "org-2", // different org
    } as any)

    const { POST } = await import("@/app/api/contracts/[id]/ask/route")

    const req = new Request("http://localhost/api/contracts/c1/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "What is the governing law?" }),
    })

    const res = await requestContext.run(mockCtx, () =>
      POST(req, { params: Promise.resolve({ id: "c1" }) }),
    )
    expect(res.status).toBe(404)
  })

  it("returns 503 when no AI provider is configured", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      id: "c1",
      title: "Test Contract",
      extractedText: "This is the contract text.",
      organizationId: "org-1",
    } as any)

    // No API keys set (cleared in beforeEach)
    const { POST } = await import("@/app/api/contracts/[id]/ask/route")

    const req = new Request("http://localhost/api/contracts/c1/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "What is the notice period?" }),
    })

    const res = await requestContext.run(mockCtx, () =>
      POST(req, { params: Promise.resolve({ id: "c1" }) }),
    )
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe("No AI provider configured")
  })

  it("returns 404 when contract does not exist", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce(null)

    const { POST } = await import("@/app/api/contracts/[id]/ask/route")

    const req = new Request("http://localhost/api/contracts/missing/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "What are the payment terms?" }),
    })

    const res = await requestContext.run(mockCtx, () =>
      POST(req, { params: Promise.resolve({ id: "missing" }) }),
    )
    expect(res.status).toBe(404)
  })

  it("answers using retrieved chunks and returns citations", async () => {
    process.env.OPENAI_API_KEY = "test-key"

    const { generateEmbedding } = await import("@/lib/embedding")
    vi.mocked(generateEmbedding).mockResolvedValueOnce(Array.from({ length: 1536 }, () => 0.1))

    vi.mocked(prisma.contract.findUnique).mockResolvedValueOnce({
      id: "c1",
      title: "Test Contract",
      extractedText: "The customer may terminate on 30 days notice.",
      organizationId: "org-1",
    } as any)
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      {
        chunkIndex: 0,
        text: "The customer may terminate on 30 days notice.",
        similarity: 0.91,
      },
    ] as any)

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "The notice period is 30 days. See Excerpt 1." } }],
      }),
    } as any)

    const { POST } = await import("@/app/api/contracts/[id]/ask/route")

    const req = new Request("http://localhost/api/contracts/c1/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "What is the notice period?" }),
    })

    const res = await requestContext.run(mockCtx, () =>
      POST(req, { params: Promise.resolve({ id: "c1" }) }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.answer).toContain("30 days")
    expect(body.citations).toHaveLength(1)
    expect(body.citations[0].chunkIndex).toBe(0)
    expect(body.citations[0].similarity).toBe(0.91)
  })
})

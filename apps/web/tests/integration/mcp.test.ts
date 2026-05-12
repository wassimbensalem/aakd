import { describe, it, expect, vi, beforeEach } from "vitest"
import { prisma } from "@/lib/db/client"
import { resolveAuth } from "@/lib/auth/middleware"

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

// Helper: build a JSON-RPC 2.0 POST request
function mcpRequest(method: string, params?: unknown) {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer cf_live_test" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
}

// Restore resolveAuth to default authenticated context before each test
beforeEach(() => {
  vi.mocked(resolveAuth).mockResolvedValue(mockCtx)
})

describe("GET /api/mcp — discovery", () => {
  it("returns 401 when no auth is provided", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)

    const { GET } = await import("@/app/api/mcp/route")
    const res = await GET(new Request("http://localhost/api/mcp"))

    expect(res.status).toBe(401)
  })

  it("returns MCP discovery metadata and tool list", async () => {
    const { GET } = await import("@/app/api/mcp/route")
    const res = await GET(new Request("http://localhost/api/mcp"))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe("ClauseFlow MCP")
    expect(body.protocol).toBe("json-rpc-2.0")
    expect(body.endpoint).toBe("/api/mcp")
    expect(body.organizationId).toBe("org-1")
    expect(body.tools).toHaveLength(13)
  })
})

describe("POST /api/mcp — authentication", () => {
  it("returns 401 when no auth is provided", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null)

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    )

    expect(res.status).toBe(401)
  })
})

describe("POST /api/mcp — tools/list", () => {
  it("returns all 13 tools", async () => {
    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(mcpRequest("tools/list"))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.jsonrpc).toBe("2.0")
    expect(body.id).toBe(1)
    expect(body.result.tools).toHaveLength(13)

    const names = body.result.tools.map((t: { name: string }) => t.name)
    expect(names).toContain("search_contracts")
    expect(names).toContain("get_contract")
    expect(names).toContain("create_contract")
    expect(names).toContain("list_contracts")
    expect(names).toContain("semantic_search")
    expect(names).toContain("ask_contract")
    expect(names).toContain("list_obligations")
    expect(names).toContain("create_obligation")
    expect(names).toContain("update_obligation")
    expect(names).toContain("get_analytics_summary")
    expect(names).toContain("list_crm_links")
    expect(names).toContain("list_import_jobs")
    expect(names).toContain("get_import_job")
  })

  it("each tool has name, description, and inputSchema", async () => {
    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(mcpRequest("tools/list"))
    const body = await res.json()

    for (const tool of body.result.tools) {
      expect(tool).toHaveProperty("name")
      expect(tool).toHaveProperty("description")
      expect(tool).toHaveProperty("inputSchema")
      expect(tool.inputSchema).toHaveProperty("type", "object")
    }
  })
})

describe("POST /api/mcp — tools/call search_contracts", () => {
  it("returns matching results for a short query (ILIKE path)", async () => {
    const mockContracts = [
      {
        id: "c1",
        title: "AB NDA",
        contractType: "NDA",
        status: "ACTIVE",
        counterpartyName: "Acme",
        value: 5000,
        currency: "USD",
        endDate: null,
        createdAt: new Date("2024-01-01"),
      },
    ]

    vi.mocked(prisma.contract.findMany).mockResolvedValue(mockContracts as any)

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", { name: "search_contracts", arguments: { query: "AB" } }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.content[0].type).toBe("text")
    expect(body.result.isError).toBeUndefined()

    const data = JSON.parse(body.result.content[0].text)
    expect(data.results).toHaveLength(1)
    expect(data.results[0].id).toBe("c1")
  })

  it("returns matching results for a longer query (FTS path)", async () => {
    const mockRows = [
      {
        id: "c2",
        title: "Service Agreement",
        contractType: "MSA",
        status: "DRAFT",
        counterpartyName: "Vendor Corp",
        value: null,
        currency: "USD",
        endDate: null,
        createdAt: new Date("2024-03-01"),
      },
    ]

    vi.mocked(prisma.$queryRaw as any).mockResolvedValue(mockRows)

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", {
        name: "search_contracts",
        arguments: { query: "service agreement", limit: 5 },
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    const data = JSON.parse(body.result.content[0].text)
    expect(data.results).toHaveLength(1)
    expect(data.count).toBe(1)
  })

  it("returns isError:true for missing required query argument", async () => {
    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", { name: "search_contracts", arguments: {} }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBe(true)
  })
})

describe("POST /api/mcp — tools/call get_contract", () => {
  it("returns contract data for a valid ID in the same org", async () => {
    const mockContract = {
      id: "c1",
      title: "My NDA",
      contractType: "NDA",
      status: "ACTIVE",
      organizationId: "org-1",
      counterpartyName: "Acme",
      value: 10000,
      currency: "USD",
      owner: { id: "user-1", name: "Alice", email: "alice@example.com" },
      tags: [],
      files: [],
      extractions: [],
    }

    vi.mocked(prisma.contract.findUnique).mockResolvedValue(mockContract as any)

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", { name: "get_contract", arguments: { id: "c1" } }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBeUndefined()

    const data = JSON.parse(body.result.content[0].text)
    expect(data.id).toBe("c1")
    expect(data.title).toBe("My NDA")
  })

  it("returns isError:true when contract belongs to a different org", async () => {
    const mockContract = {
      id: "c2",
      title: "Other Org Contract",
      organizationId: "org-2", // different org
      owner: { id: "user-2", name: "Bob", email: "bob@example.com" },
      tags: [],
      files: [],
      extractions: [],
    }

    vi.mocked(prisma.contract.findUnique).mockResolvedValue(mockContract as any)

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", { name: "get_contract", arguments: { id: "c2" } }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBe(true)
    // Must not reveal the contract exists — same message as "not found"
    expect(body.result.content[0].text).toMatch(/not found/i)
  })

  it("returns isError:true when contract does not exist", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValue(null)

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", { name: "get_contract", arguments: { id: "ghost" } }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toMatch(/not found/i)
  })
})

describe("POST /api/mcp — tools/call create_contract", () => {
  it("creates a contract and returns id, title, status", async () => {
    const mockContract = {
      id: "new-contract-1",
      title: "New NDA",
      status: "DRAFT",
    }

    vi.mocked(prisma.contract.create).mockResolvedValue(mockContract as any)

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", {
        name: "create_contract",
        arguments: { title: "New NDA", contractType: "NDA" },
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBeUndefined()

    const data = JSON.parse(body.result.content[0].text)
    expect(data.id).toBe("new-contract-1")
    expect(data.title).toBe("New NDA")
    expect(data.status).toBe("DRAFT")
  })

  it("writes CREATED activity after creating a contract", async () => {
    vi.mocked(prisma.contract.create).mockResolvedValue({
      id: "c-act",
      title: "Activity Test",
      status: "DRAFT",
    } as any)

    const { writeActivity } = await import("@/lib/db/activity")
    const { POST } = await import("@/app/api/mcp/route")

    await POST(
      mcpRequest("tools/call", {
        name: "create_contract",
        arguments: { title: "Activity Test" },
      }),
    )

    expect(writeActivity).toHaveBeenCalledWith("c-act", "user-1", "CREATED")
  })

  it("returns isError:true when title is missing", async () => {
    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", {
        name: "create_contract",
        arguments: { contractType: "NDA" },
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBe(true)
  })
})

describe("POST /api/mcp — tools/call list_contracts", () => {
  it("returns contracts with pagination metadata", async () => {
    const mockContracts = [
      {
        id: "c1",
        title: "NDA 1",
        status: "ACTIVE",
        organizationId: "org-1",
        owner: { id: "user-1", name: "Alice", email: "alice@example.com" },
        tags: [],
      },
      {
        id: "c2",
        title: "MSA 2",
        status: "DRAFT",
        organizationId: "org-1",
        owner: { id: "user-1", name: "Alice", email: "alice@example.com" },
        tags: [],
      },
    ]

    vi.mocked(prisma.contract.findMany).mockResolvedValue(mockContracts as any)
    vi.mocked(prisma.contract.count as any).mockResolvedValue(2)

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", {
        name: "list_contracts",
        arguments: { limit: 20, page: 1 },
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBeUndefined()

    const data = JSON.parse(body.result.content[0].text)
    expect(data.contracts).toHaveLength(2)
    expect(data.total).toBe(2)
    expect(data.page).toBe(1)
  })

  it("applies status filter when provided", async () => {
    vi.mocked(prisma.contract.findMany).mockResolvedValue([])
    vi.mocked(prisma.contract.count as any).mockResolvedValue(0)

    const { POST } = await import("@/app/api/mcp/route")
    await POST(
      mcpRequest("tools/call", {
        name: "list_contracts",
        arguments: { status: "ACTIVE" },
      }),
    )

    expect(prisma.contract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "ACTIVE" }),
      }),
    )
  })
})

describe("POST /api/mcp — error handling", () => {
  it("returns -32601 error for an unknown method", async () => {
    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(mcpRequest("tools/unknown_method"))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.jsonrpc).toBe("2.0")
    expect(body.id).toBe(1)
    expect(body.error.code).toBe(-32601)
    expect(body.error.message).toMatch(/method not found/i)
  })

  it("returns isError:true for an unknown tool name", async () => {
    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", { name: "nonexistent_tool", arguments: {} }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toMatch(/unknown tool/i)
  })

  it("returns 400 for malformed JSON-RPC (missing id)", async () => {
    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list" }), // no id
      }),
    )

    expect(res.status).toBe(400)
  })
})

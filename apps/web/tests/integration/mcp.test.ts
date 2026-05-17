import { describe, it, expect, vi, beforeEach } from "vitest"
import { prisma } from "@/lib/db/client"
import { resolveAuth } from "@/lib/auth/middleware"

const mockCtx = {
  userId: "user-1",
  organizationId: "org-1",
  role: "admin",
  source: "session" as const,
  requestId: "test-request-id",
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

  it("returns 202 for a JSON-RPC notification (no id)", async () => {
    // In JSON-RPC 2.0, a message without an `id` is a notification. The server
    // must NOT return a response body — 202 is the correct acknowledgement.
    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list" }), // no id → notification
      }),
    )

    expect(res.status).toBe(202)
  })
})

// ---------------------------------------------------------------------------
// MCP protocol — initialize + ping
// ---------------------------------------------------------------------------

describe("POST /api/mcp — initialize", () => {
  it("returns protocolVersion, capabilities, and serverInfo", async () => {
    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(mcpRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.1" },
    }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.jsonrpc).toBe("2.0")
    expect(body.result.protocolVersion).toBe("2024-11-05")
    expect(body.result.capabilities).toHaveProperty("tools")
    expect(body.result.serverInfo.name).toBe("Aakd MCP")
  })

  it("returns 202 for notifications/initialized (no id)", async () => {
    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer cf_live_test" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), // no id
      }),
    )

    expect(res.status).toBe(202)
  })

  it("returns empty result for ping", async () => {
    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(mcpRequest("ping"))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// M7: obligations tools
// ---------------------------------------------------------------------------

describe("POST /api/mcp — tools/call list_obligations", () => {
  it("returns obligations for a valid contract in the same org", async () => {
    const mockContract = { id: "c1", organizationId: "org-1" }
    const mockObligations = [
      {
        id: "obl-1",
        contractId: "c1",
        title: "Pay invoice",
        status: "PENDING",
        priority: "HIGH",
        dueDate: new Date("2025-12-31"),
        assignee: null,
        createdBy: { id: "user-1", name: "Alice" },
        subTasks: [],
      },
    ]

    vi.mocked(prisma.contract.findUnique).mockResolvedValue(mockContract as any)
    vi.mocked(prisma.contractObligation.findMany).mockResolvedValue(mockObligations as any)

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", { name: "list_obligations", arguments: { contractId: "c1" } }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBeUndefined()
    const data = JSON.parse(body.result.content[0].text)
    expect(data.obligations).toHaveLength(1)
    expect(data.count).toBe(1)
  })

  it("returns isError:true when contract belongs to a different org", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValue({
      id: "c2",
      organizationId: "org-2",
    } as any)

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", { name: "list_obligations", arguments: { contractId: "c2" } }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toMatch(/not found/i)
  })

  it("returns isError:true when contractId is missing", async () => {
    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", { name: "list_obligations", arguments: {} }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBe(true)
  })
})

describe("POST /api/mcp — tools/call create_obligation", () => {
  it("creates an obligation and returns it", async () => {
    const mockContract = { id: "c1", organizationId: "org-1", status: "ACTIVE" }
    const mockObligation = {
      id: "obl-new",
      contractId: "c1",
      title: "Send report",
      status: "PENDING",
      priority: "MEDIUM",
      dueDate: new Date("2025-12-31T00:00:00Z"),
      assignee: null,
      subTasks: [],
    }

    vi.mocked(prisma.contract.findUnique).mockResolvedValue(mockContract as any)
    vi.mocked(prisma.member.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.contractObligation.count).mockResolvedValue(0 as any)
    vi.mocked(prisma.contractObligation.create).mockResolvedValue(mockObligation as any)

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", {
        name: "create_obligation",
        arguments: { contractId: "c1", title: "Send report", dueDate: "2025-12-31T00:00:00Z" },
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBeUndefined()
    const data = JSON.parse(body.result.content[0].text)
    expect(data.id).toBe("obl-new")
  })

  it("returns isError:true when creating obligation on archived contract", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValue({
      id: "c1",
      organizationId: "org-1",
      status: "ARCHIVED",
    } as any)

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", {
        name: "create_obligation",
        arguments: { contractId: "c1", title: "Cannot add", dueDate: "2025-12-31T00:00:00Z" },
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toMatch(/archived/i)
  })

  it("returns isError:true when obligation limit (100) is reached", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValue({
      id: "c1",
      organizationId: "org-1",
      status: "ACTIVE",
    } as any)
    vi.mocked(prisma.contractObligation.count).mockResolvedValue(100 as any)

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", {
        name: "create_obligation",
        arguments: { contractId: "c1", title: "One too many", dueDate: "2025-12-31T00:00:00Z" },
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toMatch(/limit/i)
  })

  it("rejects create_obligation without write scope", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce({
      ...mockCtx,
      source: "api_key" as const,
      scopes: ["read"],
    })

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", {
        name: "create_obligation",
        arguments: { contractId: "c1", title: "Blocked", dueDate: "2025-12-31T00:00:00Z" },
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toMatch(/write scope/i)
  })
})

describe("POST /api/mcp — tools/call update_obligation", () => {
  it("updates an obligation and returns it", async () => {
    const mockExisting = {
      id: "obl-1",
      contractId: "c1",
      organizationId: "org-1",
    }
    const mockUpdated = {
      id: "obl-1",
      contractId: "c1",
      title: "Updated title",
      status: "IN_PROGRESS",
      priority: "HIGH",
      dueDate: new Date("2025-12-31"),
      assignee: null,
      subTasks: [],
    }

    vi.mocked(prisma.contractObligation.findUnique).mockResolvedValue(mockExisting as any)
    vi.mocked(prisma.contractObligation.update).mockResolvedValue(mockUpdated as any)

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", {
        name: "update_obligation",
        arguments: { contractId: "c1", obligationId: "obl-1", status: "IN_PROGRESS" },
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBeUndefined()
    const data = JSON.parse(body.result.content[0].text)
    expect(data.id).toBe("obl-1")
  })

  it("returns isError:true for obligation belonging to different org", async () => {
    vi.mocked(prisma.contractObligation.findUnique).mockResolvedValue({
      id: "obl-x",
      contractId: "c1",
      organizationId: "org-2",
    } as any)

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", {
        name: "update_obligation",
        arguments: { contractId: "c1", obligationId: "obl-x", status: "COMPLETED" },
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toMatch(/not found/i)
  })
})

// ---------------------------------------------------------------------------
// M8: analytics
// ---------------------------------------------------------------------------

describe("POST /api/mcp — tools/call get_analytics_summary", () => {
  it("returns all expected analytics fields", async () => {
    // Mock the five parallel prisma calls
    vi.mocked(prisma.contract.count)
      .mockResolvedValueOnce(2)  // next30
      .mockResolvedValueOnce(4)  // next60
      .mockResolvedValueOnce(6)  // next90
    vi.mocked(prisma.contract.findMany).mockResolvedValue([])
    vi.mocked(prisma.contract.groupBy as any)
      .mockResolvedValueOnce([{ status: "ACTIVE", _count: { _all: 10 } }])
      .mockResolvedValueOnce([]) // valueByType
    vi.mocked(prisma.$queryRaw as any).mockResolvedValue([])
    vi.mocked(prisma.approval.count as any)
      .mockResolvedValueOnce(5)  // totalRequested
      .mockResolvedValueOnce(3)  // approved
      .mockResolvedValueOnce(1)  // rejected
    vi.mocked(prisma.contractObligation.count as any)
      .mockResolvedValueOnce(2)  // overdue
      .mockResolvedValueOnce(3)  // dueSoon

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", { name: "get_analytics_summary", arguments: {} }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBeUndefined()
    const data = JSON.parse(body.result.content[0].text)
    expect(data).toHaveProperty("expiringSoon")
    expect(data).toHaveProperty("byStatus")
    expect(data).toHaveProperty("monthlyVolume")
    expect(data).toHaveProperty("valueByType")
    expect(data).toHaveProperty("approvalFunnel")
    expect(data).toHaveProperty("obligations")
  })
})

// ---------------------------------------------------------------------------
// M9: CRM links
// ---------------------------------------------------------------------------

describe("POST /api/mcp — tools/call list_crm_links", () => {
  it("returns CRM links for a contract", async () => {
    const mockContract = { id: "c1", organizationId: "org-1" }
    const mockLinks = [
      {
        id: "link-1",
        provider: "HUBSPOT",
        externalDealId: "hs-123",
        externalDealName: "Deal A",
        externalDealUrl: null,
        lastSyncedAt: null,
        lastSyncStatus: null,
        createdAt: new Date("2025-01-01"),
      },
    ]

    vi.mocked(prisma.contract.findUnique).mockResolvedValue(mockContract as any)
    vi.mocked(prisma.crmLink.findMany).mockResolvedValue(mockLinks as any)

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", { name: "list_crm_links", arguments: { contractId: "c1" } }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBeUndefined()
    const data = JSON.parse(body.result.content[0].text)
    expect(data.links).toHaveLength(1)
    expect(data.count).toBe(1)
  })

  it("returns isError:true when contract belongs to a different org", async () => {
    vi.mocked(prisma.contract.findUnique).mockResolvedValue({
      id: "c-other",
      organizationId: "org-2",
    } as any)

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", { name: "list_crm_links", arguments: { contractId: "c-other" } }),
    )

    const body = await res.json()
    expect(body.result.isError).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// M10: import jobs
// ---------------------------------------------------------------------------

describe("POST /api/mcp — tools/call list_import_jobs", () => {
  it("returns import jobs with pagination metadata", async () => {
    const mockJobs = [
      {
        id: "job-1",
        source: "CSV",
        status: "COMPLETED",
        totalRows: 50,
        succeededRows: 48,
        failedRows: 2,
        createdAt: new Date("2025-03-01"),
        completedAt: new Date("2025-03-01"),
        createdBy: { id: "user-1", name: "Alice" },
      },
    ]

    vi.mocked(prisma.importJob.findMany).mockResolvedValue(mockJobs as any)
    vi.mocked(prisma.importJob.count as any).mockResolvedValue(1)

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", { name: "list_import_jobs", arguments: {} }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBeUndefined()
    const data = JSON.parse(body.result.content[0].text)
    expect(data.jobs).toHaveLength(1)
    expect(data.total).toBe(1)
  })
})

describe("POST /api/mcp — tools/call get_import_job", () => {
  it("returns job details and rows", async () => {
    const mockJob = {
      id: "job-1",
      organizationId: "org-1",
      source: "CSV",
      status: "COMPLETED",
      totalRows: 3,
      succeededRows: 3,
      failedRows: 0,
      createdAt: new Date("2025-03-01"),
      completedAt: new Date("2025-03-01"),
      createdBy: { id: "user-1", name: "Alice" },
    }

    vi.mocked(prisma.importJob.findUnique).mockResolvedValue(mockJob as any)
    vi.mocked(prisma.importRow.findMany).mockResolvedValue([])

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", { name: "get_import_job", arguments: { jobId: "job-1" } }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.isError).toBeUndefined()
    const data = JSON.parse(body.result.content[0].text)
    expect(data.job.id).toBe("job-1")
    expect(data.rows).toBeDefined()
  })

  it("returns isError:true when job belongs to a different org", async () => {
    vi.mocked(prisma.importJob.findUnique).mockResolvedValue({
      id: "job-other",
      organizationId: "org-2",
    } as any)

    const { POST } = await import("@/app/api/mcp/route")
    const res = await POST(
      mcpRequest("tools/call", { name: "get_import_job", arguments: { jobId: "job-other" } }),
    )

    const body = await res.json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toMatch(/not found/i)
  })
})

import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { generateEmbedding } from "@/lib/embedding"
import { QA_SYSTEM_PROMPT } from "@/lib/ai/prompts"
import { rateLimit } from "@/lib/rate-limit"
import { Prisma } from "@prisma/client"
import { z } from "zod"

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 types
// ---------------------------------------------------------------------------

interface McpRequest {
  jsonrpc: "2.0"
  id: string | number
  method: string
  params?: unknown
}

function jsonRpcResult(id: string | number, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result })
}

function jsonRpcError(id: string | number, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } })
}

function toolError(id: string | number, message: string) {
  return Response.json({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: message }],
      isError: true,
    },
  })
}

function toolSuccess(id: string | number, data: unknown) {
  return Response.json({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    },
  })
}

// ---------------------------------------------------------------------------
// Lazy Anthropic singleton — avoids re-instantiating on every ask_contract call
// ---------------------------------------------------------------------------

let _anthropic: import("@anthropic-ai/sdk").default | null = null
function getAnthropicClient() {
  if (!_anthropic && process.env.ANTHROPIC_API_KEY) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Anthropic = require("@anthropic-ai/sdk").default
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _anthropic
}

// ---------------------------------------------------------------------------
// Tool definitions (returned by tools/list)
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "search_contracts",
    description:
      "Search contracts by text query. Returns matching contracts with title, status, counterparty, and value.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text" },
        status: {
          type: "string",
          enum: [
            "DRAFT",
            "INTERNAL_REVIEW",
            "PENDING_APPROVAL",
            "AWAITING_SIGNATURE",
            "ACTIVE",
            "EXPIRED",
            "TERMINATED",
            "ARCHIVED",
          ],
          description: "Filter by status (optional)",
        },
        limit: { type: "number", description: "Max results, default 10, max 50" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_contract",
    description: "Get full details of a single contract by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Contract ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "create_contract",
    description:
      "Create a new contract record (no file upload). Returns the created contract ID.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        contractType: {
          type: "string",
          enum: ["NDA", "MSA", "SOW", "EMPLOYMENT", "VENDOR", "CUSTOMER", "OTHER"],
        },
        counterpartyName: { type: "string" },
        counterpartyContact: { type: "string", description: "Email address" },
        value: { type: "number" },
        currency: { type: "string" },
        startDate: { type: "string", description: "ISO date YYYY-MM-DD" },
        endDate: { type: "string", description: "ISO date YYYY-MM-DD" },
        notes: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "list_contracts",
    description: "List contracts with optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        contractType: { type: "string" },
        limit: { type: "number", description: "Default 20, max 100" },
        page: { type: "number", description: "Default 1" },
      },
    },
  },
  {
    name: "semantic_search",
    description:
      "Search contracts using semantic (vector) similarity. Finds contracts that are conceptually relevant to the query, even without exact keyword matches.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language search query" },
        limit: { type: "number", description: "Max results, default 10, max 50" },
      },
      required: ["query"],
    },
  },
  {
    name: "ask_contract",
    description:
      "Ask a question about a specific contract and get an AI-generated answer based on the contract text.",
    inputSchema: {
      type: "object",
      properties: {
        contractId: { type: "string", description: "Contract ID" },
        question: { type: "string", description: "Question to ask about the contract" },
      },
      required: ["contractId", "question"],
    },
  },
  // ── M7 Obligations ────────────────────────────────────────────────────────
  {
    name: "list_obligations",
    description: "List all obligations for a contract, ordered by due date.",
    inputSchema: {
      type: "object",
      properties: {
        contractId: { type: "string", description: "Contract ID" },
        status: {
          type: "string",
          enum: ["PENDING", "IN_PROGRESS", "COMPLETED", "OVERDUE"],
          description: "Filter by status (optional)",
        },
      },
      required: ["contractId"],
    },
  },
  {
    name: "create_obligation",
    description: "Create a new obligation on a contract (requires write scope).",
    inputSchema: {
      type: "object",
      properties: {
        contractId: { type: "string" },
        title: { type: "string", description: "Obligation title, max 300 chars" },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"], description: "Default MEDIUM" },
        dueDate: { type: "string", description: "ISO datetime, e.g. 2025-12-31T00:00:00Z" },
        description: { type: "string", description: "Optional details, max 2000 chars" },
        clauseReference: { type: "string", description: "e.g. Section 5.2" },
        assigneeId: { type: "string", description: "User ID to assign" },
        reminderDays: { type: "number", description: "Days before due date to send reminder, default 7" },
      },
      required: ["contractId", "title", "dueDate"],
    },
  },
  {
    name: "update_obligation",
    description: "Update an obligation's status, title, priority, or assignee (requires write scope).",
    inputSchema: {
      type: "object",
      properties: {
        contractId: { type: "string" },
        obligationId: { type: "string" },
        status: { type: "string", enum: ["PENDING", "IN_PROGRESS", "COMPLETED"] },
        title: { type: "string" },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
        dueDate: { type: "string", description: "ISO datetime" },
        assigneeId: { type: "string", nullable: true },
        description: { type: "string", nullable: true },
      },
      required: ["contractId", "obligationId"],
    },
  },
  // ── M8 Analytics ─────────────────────────────────────────────────────────
  {
    name: "get_analytics_summary",
    description:
      "Get analytics summary for the organization: expiring contracts, contract counts by status, monthly volume, value by type, approval funnel, and obligation health.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  // ── M9 CRM ────────────────────────────────────────────────────────────────
  {
    name: "list_crm_links",
    description: "List CRM deal links (HubSpot, Salesforce, Pipedrive) for a contract.",
    inputSchema: {
      type: "object",
      properties: {
        contractId: { type: "string", description: "Contract ID" },
      },
      required: ["contractId"],
    },
  },
  // ── M10 Import ────────────────────────────────────────────────────────────
  {
    name: "list_import_jobs",
    description: "List contract import jobs for the organization, most recent first.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results, default 20, max 100" },
        page: { type: "number", description: "Page number, default 1" },
      },
    },
  },
  {
    name: "get_import_job",
    description: "Get details and row-level status of a specific import job.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "Import job ID" },
      },
      required: ["jobId"],
    },
  },
]

// ---------------------------------------------------------------------------
// Tool argument schemas (Zod)
// ---------------------------------------------------------------------------

const SearchContractsSchema = z.object({
  query: z.string().min(1),
  status: z
    .enum([
      "DRAFT",
      "INTERNAL_REVIEW",
      "PENDING_APPROVAL",
      "AWAITING_SIGNATURE",
      "ACTIVE",
      "EXPIRED",
      "TERMINATED",
      "ARCHIVED",
    ])
    .optional(),
  limit: z.number().int().min(1).max(50).default(10),
})

const GetContractSchema = z.object({
  id: z.string().min(1),
})

const CreateContractSchema = z.object({
  title: z.string().min(1).max(500),
  contractType: z
    .enum(["NDA", "MSA", "SOW", "EMPLOYMENT", "VENDOR", "CUSTOMER", "OTHER"])
    .optional(),
  counterpartyName: z.string().optional(),
  counterpartyContact: z.string().email().optional().or(z.literal("")),
  value: z.number().positive().optional(),
  currency: z.string().length(3).default("USD"),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  notes: z.string().max(10000).optional(),
})

const ListContractsSchema = z.object({
  status: z.string().optional(),
  contractType: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  page: z.number().int().min(1).default(1),
})

const SemanticSearchMcpSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
})

const AskContractMcpSchema = z.object({
  contractId: z.string().min(1),
  question: z.string().min(1).max(2000),
})

// M7
const ListObligationsSchema = z.object({
  contractId: z.string().min(1),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "OVERDUE"]).optional(),
})

const CreateObligationMcpSchema = z.object({
  contractId: z.string().min(1),
  title: z.string().min(1).max(300),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  dueDate: z.string().min(1),
  description: z.string().max(2000).optional(),
  clauseReference: z.string().max(200).optional(),
  assigneeId: z.string().optional(),
  reminderDays: z.number().int().min(1).max(30).default(7),
})

const UpdateObligationMcpSchema = z.object({
  contractId: z.string().min(1),
  obligationId: z.string().min(1),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED"]).optional(),
  title: z.string().min(1).max(300).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  dueDate: z.string().optional(),
  assigneeId: z.string().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
})

// M9
const ListCrmLinksSchema = z.object({
  contractId: z.string().min(1),
})

// M10
const ListImportJobsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  page: z.number().int().min(1).default(1),
})

const GetImportJobSchema = z.object({
  jobId: z.string().min(1),
})

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function toolSearchContracts(
  args: unknown,
  orgId: string,
  id: string | number,
): Promise<Response> {
  const parsed = SearchContractsSchema.safeParse(args)
  if (!parsed.success) {
    return toolError(id, `Invalid arguments: ${JSON.stringify(parsed.error.flatten())}`)
  }

  const { query: q, status, limit } = parsed.data
  const useIlike = q.length < 3

  type SearchRow = {
    id: string
    title: string
    contractType: string | null
    status: string
    counterpartyName: string | null
    value: number | null
    currency: string | null
    endDate: Date | null
    createdAt: Date
  }

  let results: SearchRow[]

  if (useIlike) {
    results = await prisma.contract.findMany({
      where: {
        organizationId: orgId,
        title: { contains: q, mode: "insensitive" },
        ...(status ? { status } : {}),
      },
      select: {
        id: true,
        title: true,
        contractType: true,
        status: true,
        counterpartyName: true,
        value: true,
        currency: true,
        endDate: true,
        createdAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    })
  } else {
    try {
      results = await prisma.$queryRaw<SearchRow[]>(
        Prisma.sql`
          SELECT
            id,
            title,
            "contractType",
            status,
            "counterpartyName",
            value,
            currency,
            "endDate",
            "createdAt"
          FROM "Contract"
          WHERE "organizationId" = ${orgId}
            ${status ? Prisma.sql`AND status = ${status}` : Prisma.empty}
            AND search_tsv @@ plainto_tsquery('english', ${q})
          ORDER BY ts_rank(search_tsv, plainto_tsquery('english', ${q})) DESC
          LIMIT ${limit}
        `,
      )
    } catch {
      // tsquery parse failure — fall back to ILIKE
      results = await prisma.contract.findMany({
        where: {
          organizationId: orgId,
          title: { contains: q, mode: "insensitive" },
          ...(status ? { status } : {}),
        },
        select: {
          id: true,
          title: true,
          contractType: true,
          status: true,
          counterpartyName: true,
          value: true,
          currency: true,
          endDate: true,
          createdAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
      })
    }
  }

  return toolSuccess(id, { results, count: results.length })
}

async function toolGetContract(
  args: unknown,
  orgId: string,
  id: string | number,
): Promise<Response> {
  const parsed = GetContractSchema.safeParse(args)
  if (!parsed.success) {
    return toolError(id, `Invalid arguments: ${JSON.stringify(parsed.error.flatten())}`)
  }

  const contract = await prisma.contract.findUnique({
    where: { id: parsed.data.id },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      tags: true,
      files: {
        where: { isLatest: true },
        select: { id: true, filename: true, mimeType: true, sizeBytes: true, version: true, createdAt: true },
      },
      extractions: {
        select: {
          id: true,
          field: true,
          rawValue: true,
          confidence: true,
          sourceText: true,
          sourcePage: true,
          extractedBy: true,
          status: true,
        },
      },
    },
  })

  if (!contract) {
    return toolError(id, "Error: Contract not found")
  }

  if (contract.organizationId !== orgId) {
    return toolError(id, "Error: Contract not found")
  }

  return toolSuccess(id, contract)
}

async function toolCreateContract(
  args: unknown,
  orgId: string,
  userId: string,
  id: string | number,
): Promise<Response> {
  // Mirror the rate limit on POST /api/contracts so MCP clients can't
  // bypass it by going through the JSON-RPC endpoint.
  const rl = await rateLimit(`${orgId}:create-contract`, 20, 60_000)
  if (!rl.allowed) {
    return toolError(
      id,
      `Rate limit exceeded — retry after ${rl.retryAfter}s`,
    )
  }

  const parsed = CreateContractSchema.safeParse(args)
  if (!parsed.success) {
    return toolError(id, `Invalid arguments: ${JSON.stringify(parsed.error.flatten())}`)
  }

  const { startDate, endDate, ...rest } = parsed.data

  const data: Prisma.ContractUncheckedCreateInput = {
    ...rest,
    ownerId: userId,
    organizationId: orgId,
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
  }

  const contract = await prisma.contract.create({
    data,
    select: { id: true, title: true, status: true },
  })

  await writeActivity(contract.id, userId, "CREATED")

  return toolSuccess(id, contract)
}

async function toolListContracts(
  args: unknown,
  orgId: string,
  id: string | number,
): Promise<Response> {
  const parsed = ListContractsSchema.safeParse(args)
  if (!parsed.success) {
    return toolError(id, `Invalid arguments: ${JSON.stringify(parsed.error.flatten())}`)
  }

  const { status, contractType, limit, page } = parsed.data

  const where: Record<string, unknown> = { organizationId: orgId }
  if (status) {
    where.status = status
  } else {
    // Hide soft-deleted contracts unless the caller explicitly asks for them.
    where.status = { not: "ARCHIVED" }
  }
  if (contractType) where.contractType = contractType

  const [contracts, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        tags: true,
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.contract.count({ where }),
  ])

  return toolSuccess(id, { contracts, total, page, limit })
}

async function toolSemanticSearch(
  args: unknown,
  orgId: string,
  id: string | number,
): Promise<Response> {
  const parsed = SemanticSearchMcpSchema.safeParse(args)
  if (!parsed.success) {
    return toolError(id, `Invalid arguments: ${JSON.stringify(parsed.error.flatten())}`)
  }

  const { query, limit } = parsed.data

  let embedding: number[] | null
  try {
    embedding = await generateEmbedding(query)
  } catch (err) {
    return toolError(id, `Embedding generation failed: ${String(err)}`)
  }

  if (!embedding) {
    return toolError(id, "Error: Embedding provider not configured")
  }

  type SemanticRow = {
    id: string
    title: string
    contractType: string | null
    status: string
    counterpartyName: string | null
    value: number | null
    currency: string | null
    endDate: Date | null
    createdAt: Date
    similarity: number
  }

  const embeddingStr = `[${embedding.join(",")}]`

  const rows = await prisma.$queryRaw<SemanticRow[]>(
    Prisma.sql`
      SELECT
        c.id,
        c.title,
        c."contractType",
        c.status,
        c."counterpartyName",
        c.value,
        c.currency,
        c."endDate",
        c."createdAt",
        1 - (ce.embedding <=> ${embeddingStr}::vector) AS similarity
      FROM "ContractEmbedding" ce
      JOIN "Contract" c ON c.id = ce."contractId"
      WHERE c."organizationId" = ${orgId}
        AND 1 - (ce.embedding <=> ${embeddingStr}::vector) > 0.3
      ORDER BY ce.embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `,
  )

  return toolSuccess(id, { results: rows, total: rows.length })
}

async function toolAskContract(
  args: unknown,
  orgId: string,
  id: string | number,
): Promise<Response> {
  const parsed = AskContractMcpSchema.safeParse(args)
  if (!parsed.success) {
    return toolError(id, `Invalid arguments: ${JSON.stringify(parsed.error.flatten())}`)
  }

  const { contractId, question } = parsed.data

  const rl = await rateLimit(`${orgId}:ask-contract`, 10, 60_000)
  if (!rl.allowed) {
    return toolError(id, `Rate limit exceeded — retry after ${rl.retryAfter}s`)
  }

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      title: true,
      extractedText: true,
      organizationId: true,
    },
  })

  if (!contract || contract.organizationId !== orgId) {
    return toolError(id, "Error: Contract not found")
  }

  if (!contract.extractedText) {
    return toolError(id, "Error: No extracted text available for this contract")
  }

  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    return toolError(id, "Error: No AI provider configured")
  }

  const userContent = `Contract: ${contract.title}\n\nContract text:\n${contract.extractedText.slice(0, 40000)}\n\nQuestion: ${question}`

  let answer: string | null = null

  try {
    const anthropic = getAnthropicClient()
    if (anthropic) {
      const msg = await anthropic.messages.create({
        model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
        max_tokens: 1024,
        system: QA_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      })
      const block = msg.content.find((b) => b.type === "text")
      answer = block?.type === "text" ? block.text.trim() : null
    } else if (process.env.OPENAI_API_KEY) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
          max_tokens: 1024,
          messages: [
            { role: "system", content: QA_SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
        }),
      })
      if (res.ok) {
        const data = (await res.json()) as {
          choices: Array<{ message: { content: string | null } }>
        }
        answer = data.choices[0]?.message.content?.trim() ?? null
      }
    }
  } catch (err) {
    return toolError(id, `Error: AI call failed: ${String(err)}`)
  }

  if (!answer) {
    return toolError(id, "Error: No AI provider configured or call returned empty")
  }

  return toolSuccess(id, { answer, contractId: contract.id, contractTitle: contract.title })
}

// ── M7 Obligations ────────────────────────────────────────────────────────

async function toolListObligations(
  args: unknown,
  orgId: string,
  id: string | number,
): Promise<Response> {
  const parsed = ListObligationsSchema.safeParse(args)
  if (!parsed.success) {
    return toolError(id, `Invalid arguments: ${JSON.stringify(parsed.error.flatten())}`)
  }

  const { contractId, status } = parsed.data

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { id: true, organizationId: true },
  })
  if (!contract || contract.organizationId !== orgId) {
    return toolError(id, "Error: Contract not found")
  }

  const obligations = await prisma.contractObligation.findMany({
    where: {
      contractId,
      ...(status ? { status } : {}),
    },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      createdBy: { select: { id: true, name: true } },
      subTasks: { orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  })

  return toolSuccess(id, { obligations, count: obligations.length })
}

async function toolCreateObligation(
  args: unknown,
  orgId: string,
  userId: string,
  id: string | number,
): Promise<Response> {
  const rl = await rateLimit(`${orgId}:create-obligation`, 30, 60_000)
  if (!rl.allowed) {
    return toolError(id, `Rate limit exceeded — retry after ${rl.retryAfter}s`)
  }

  const parsed = CreateObligationMcpSchema.safeParse(args)
  if (!parsed.success) {
    return toolError(id, `Invalid arguments: ${JSON.stringify(parsed.error.flatten())}`)
  }

  const { contractId, title, priority, dueDate, description, clauseReference, assigneeId, reminderDays } = parsed.data

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { id: true, organizationId: true, status: true },
  })
  if (!contract || contract.organizationId !== orgId) {
    return toolError(id, "Error: Contract not found")
  }
  if (contract.status === "ARCHIVED") {
    return toolError(id, "Error: Cannot add obligations to an archived contract")
  }

  if (assigneeId) {
    const member = await prisma.member.findFirst({
      where: { userId: assigneeId, organizationId: orgId },
      select: { userId: true },
    })
    if (!member) {
      return toolError(id, "Error: Assignee is not a member of this organization")
    }
  }

  const activeCount = await prisma.contractObligation.count({
    where: { contractId, status: { in: ["PENDING", "IN_PROGRESS"] } },
  })
  if (activeCount >= 100) {
    return toolError(id, "Error: Obligation limit reached (100 active obligations per contract)")
  }

  let dueDateParsed: Date
  try {
    dueDateParsed = new Date(dueDate)
    if (isNaN(dueDateParsed.getTime())) throw new Error("invalid date")
  } catch {
    return toolError(id, "Error: Invalid dueDate format — use ISO datetime e.g. 2025-12-31T00:00:00Z")
  }

  const obligation = await prisma.contractObligation.create({
    data: {
      contractId,
      organizationId: orgId,
      title,
      description,
      clauseReference,
      priority,
      dueDate: dueDateParsed,
      assigneeId,
      reminderDays,
      createdById: userId,
    },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      subTasks: true,
    },
  })

  // Audit trail — must not be fire-and-forget
  await writeActivity(contractId, userId, "OBLIGATION_CREATED", `Obligation created: ${obligation.title}`, {
    obligationId: obligation.id,
  })

  return toolSuccess(id, obligation)
}

async function toolUpdateObligation(
  args: unknown,
  orgId: string,
  userId: string,
  id: string | number,
): Promise<Response> {
  const rl = await rateLimit(`${orgId}:update-obligation`, 60, 60_000)
  if (!rl.allowed) {
    return toolError(id, `Rate limit exceeded — retry after ${rl.retryAfter}s`)
  }

  const parsed = UpdateObligationMcpSchema.safeParse(args)
  if (!parsed.success) {
    return toolError(id, `Invalid arguments: ${JSON.stringify(parsed.error.flatten())}`)
  }

  const { contractId, obligationId, dueDate, ...rest } = parsed.data

  const existing = await prisma.contractObligation.findUnique({
    where: { id: obligationId },
    select: { id: true, contractId: true, organizationId: true },
  })
  if (!existing || existing.contractId !== contractId || existing.organizationId !== orgId) {
    return toolError(id, "Error: Obligation not found")
  }

  let dueDateParsed: Date | undefined
  if (dueDate !== undefined) {
    dueDateParsed = new Date(dueDate)
    if (isNaN(dueDateParsed.getTime())) {
      return toolError(id, "Error: Invalid dueDate format")
    }
  }

  const obligation = await prisma.contractObligation.update({
    where: { id: obligationId },
    data: {
      ...rest,
      ...(dueDateParsed !== undefined ? { dueDate: dueDateParsed } : {}),
    },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      subTasks: true,
    },
  })

  // Audit trail — must not be fire-and-forget
  await writeActivity(contractId, userId, "OBLIGATION_UPDATED", `Obligation updated: ${obligation.title}`, {
    obligationId: obligation.id,
  })

  return toolSuccess(id, obligation)
}

// ── M8 Analytics ─────────────────────────────────────────────────────────

async function toolGetAnalyticsSummary(
  orgId: string,
  id: string | number,
): Promise<Response> {
  const now = new Date()
  const DAY_MS = 86_400_000
  const d30 = new Date(now.getTime() + 30 * DAY_MS)
  const d60 = new Date(now.getTime() + 60 * DAY_MS)
  const d90 = new Date(now.getTime() + 90 * DAY_MS)

  const twelveMonthsAgo = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1),
  )

  const [next30, next60, next90, expiringContracts] = await Promise.all([
    prisma.contract.count({ where: { organizationId: orgId, status: "ACTIVE", endDate: { gte: now, lte: d30 } } }),
    prisma.contract.count({ where: { organizationId: orgId, status: "ACTIVE", endDate: { gte: now, lte: d60 } } }),
    prisma.contract.count({ where: { organizationId: orgId, status: "ACTIVE", endDate: { gte: now, lte: d90 } } }),
    prisma.contract.findMany({
      where: { organizationId: orgId, status: "ACTIVE", endDate: { gte: now, lte: d90 } },
      orderBy: { endDate: "asc" },
      take: 10,
      select: { id: true, title: true, endDate: true, counterpartyName: true, contractType: true },
    }),
  ])

  const expiringSoon = {
    next30,
    next60,
    next90,
    contracts: expiringContracts.map((c) => ({
      id: c.id,
      title: c.title,
      endDate: c.endDate ? c.endDate.toISOString() : "",
      counterpartyName: c.counterpartyName ?? null,
      contractType: c.contractType ?? null,
      daysUntilExpiry: c.endDate
        ? Math.ceil((c.endDate.getTime() - now.getTime()) / DAY_MS)
        : 0,
    })),
  }

  const grouped = await prisma.contract.groupBy({
    by: ["status"],
    where: { organizationId: orgId },
    _count: { _all: true },
  })
  const byStatus = grouped.map((g) => ({ status: g.status, count: g._count._all }))

  const rows = await prisma.$queryRaw<Array<{ month: string; count: bigint }>>`
    SELECT TO_CHAR(DATE_TRUNC('month', "createdAt"), 'YYYY-MM') AS month,
           COUNT(*)::bigint AS count
    FROM "Contract"
    WHERE "organizationId" = ${orgId}
      AND "createdAt" >= ${twelveMonthsAgo}
    GROUP BY 1
    ORDER BY 1 ASC
  `
  const rowsByMonth = new Map(rows.map((r) => [r.month, Number(r.count)]))
  const monthlyVolume: Array<{ month: string; count: number }> = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(
      Date.UTC(twelveMonthsAgo.getUTCFullYear(), twelveMonthsAgo.getUTCMonth() + i, 1),
    )
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, "0")
    const key = `${y}-${m}`
    monthlyVolume.push({ month: key, count: rowsByMonth.get(key) ?? 0 })
  }

  const valueGrouped = await prisma.contract.groupBy({
    by: ["contractType"],
    where: { organizationId: orgId, value: { not: null } },
    _sum: { value: true },
    _count: { _all: true },
  })
  const valueByType = valueGrouped
    .filter((g) => g.contractType !== null)
    .map((g) => ({
      contractType: g.contractType as string,
      totalValue: g._sum.value ?? 0,
      count: g._count._all,
    }))

  const approvalScope = { contract: { organizationId: orgId } }
  const [totalRequested, approvedCount, rejectedCount] = await Promise.all([
    prisma.approval.count({ where: approvalScope }),
    prisma.approval.count({ where: { ...approvalScope, status: "approved" } }),
    prisma.approval.count({ where: { ...approvalScope, status: "rejected" } }),
  ])
  const approvalFunnel = {
    totalRequested,
    approved: approvedCount,
    rejected: rejectedCount,
    pending: Math.max(0, totalRequested - approvedCount - rejectedCount),
  }

  let obligations: { overdue: number; dueSoon: number } | null = null
  try {
    const dueSoonCutoff = new Date(now.getTime() + 7 * DAY_MS)
    const oblScope = { contract: { organizationId: orgId } }
    const [overdue, dueSoon] = await Promise.all([
      prisma.contractObligation.count({ where: { ...oblScope, status: "OVERDUE" } }),
      prisma.contractObligation.count({
        where: {
          ...oblScope,
          status: { in: ["PENDING", "IN_PROGRESS"] },
          dueDate: { lte: dueSoonCutoff },
        },
      }),
    ])
    obligations = { overdue, dueSoon }
  } catch {
    obligations = null
  }

  return toolSuccess(id, {
    expiringSoon,
    byStatus,
    monthlyVolume,
    valueByType,
    approvalFunnel,
    obligations,
  })
}

// ── M9 CRM ────────────────────────────────────────────────────────────────

async function toolListCrmLinks(
  args: unknown,
  orgId: string,
  id: string | number,
): Promise<Response> {
  const parsed = ListCrmLinksSchema.safeParse(args)
  if (!parsed.success) {
    return toolError(id, `Invalid arguments: ${JSON.stringify(parsed.error.flatten())}`)
  }

  const { contractId } = parsed.data

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { id: true, organizationId: true },
  })
  if (!contract || contract.organizationId !== orgId) {
    return toolError(id, "Error: Contract not found")
  }

  const links = await prisma.crmLink.findMany({
    where: { contractId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      provider: true,
      externalDealId: true,
      externalDealName: true,
      externalDealUrl: true,
      lastSyncedAt: true,
      lastSyncStatus: true,
      createdAt: true,
    },
  })

  return toolSuccess(id, { links, count: links.length })
}

// ── M10 Import ────────────────────────────────────────────────────────────

async function toolListImportJobs(
  args: unknown,
  orgId: string,
  id: string | number,
): Promise<Response> {
  const parsed = ListImportJobsSchema.safeParse(args)
  if (!parsed.success) {
    return toolError(id, `Invalid arguments: ${JSON.stringify(parsed.error.flatten())}`)
  }

  const { limit, page } = parsed.data
  const where = { organizationId: orgId }
  const [jobs, total] = await Promise.all([
    prisma.importJob.findMany({
      where,
      select: {
        id: true,
        source: true,
        status: true,
        totalRows: true,
        succeededRows: true,
        failedRows: true,
        createdAt: true,
        completedAt: true,
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.importJob.count({ where }),
  ])

  return toolSuccess(id, { jobs, total, page, limit })
}

async function toolGetImportJob(
  args: unknown,
  orgId: string,
  id: string | number,
): Promise<Response> {
  const parsed = GetImportJobSchema.safeParse(args)
  if (!parsed.success) {
    return toolError(id, `Invalid arguments: ${JSON.stringify(parsed.error.flatten())}`)
  }

  const job = await prisma.importJob.findUnique({
    where: { id: parsed.data.jobId },
    include: { createdBy: { select: { id: true, name: true } } },
  })
  if (!job || job.organizationId !== orgId) {
    return toolError(id, "Error: Import job not found")
  }

  // For large jobs, only return failed rows to keep response size reasonable
  const FULL_ROW_THRESHOLD = 200
  const rowWhere =
    job.totalRows > FULL_ROW_THRESHOLD
      ? { jobId: job.id, status: "failed" }
      : { jobId: job.id }

  const rows = await prisma.importRow.findMany({
    where: rowWhere,
    orderBy: { rowIndex: "asc" },
    select: {
      id: true,
      rowIndex: true,
      sourceRef: true,
      status: true,
      errorMessage: true,
      contractId: true,
    },
  })

  return toolSuccess(id, { job, rows, rowsNote: job.totalRows > FULL_ROW_THRESHOLD ? "Only failed rows shown for large jobs" : null })
}

// ---------------------------------------------------------------------------
// Main POST handler
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return new Response("Unauthorized", { status: 401 })

  return Response.json({
    name: "Aakd MCP",
    protocol: "json-rpc-2.0",
    endpoint: "/api/mcp",
    organizationId: ctx.organizationId,
    tools: TOOLS,
  })
}

export async function POST(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return new Response("Unauthorized", { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response("Invalid JSON", { status: 400 })
  }

  // JSON-RPC 2.0 notifications have no `id` — they don't expect a response.
  // Accept and silently acknowledge them (e.g. notifications/initialized).
  const raw = body as Record<string, unknown>
  if (
    raw &&
    typeof raw === "object" &&
    raw.jsonrpc === "2.0" &&
    typeof raw.method === "string" &&
    raw.id === undefined
  ) {
    return new Response(null, { status: 202 })
  }

  // Validate JSON-RPC request envelope
  const envelope = body as McpRequest
  if (
    !envelope ||
    typeof envelope !== "object" ||
    envelope.jsonrpc !== "2.0" ||
    typeof envelope.method !== "string" ||
    (typeof envelope.id !== "string" && typeof envelope.id !== "number")
  ) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
      { status: 400 },
    )
  }

  const { id, method, params } = envelope

  return requestContext.run(ctx, async () => {
    // initialize — MCP 2024-11-05 handshake (required by all standard clients)
    if (method === "initialize") {
      return jsonRpcResult(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "Aakd MCP", version: "1.0.0" },
      })
    }

    // ping — keepalive
    if (method === "ping") {
      return jsonRpcResult(id, {})
    }

    // tools/list
    if (method === "tools/list") {
      return jsonRpcResult(id, { tools: TOOLS })
    }

    // tools/call
    if (method === "tools/call") {
      const callParams = params as { name?: string; arguments?: Record<string, unknown> } | undefined
      const toolName = callParams?.name
      const toolArgs = callParams?.arguments ?? {}

      if (!toolName) {
        return jsonRpcError(id, -32602, "Invalid params: missing tool name")
      }

      switch (toolName) {
        case "search_contracts":
          return toolSearchContracts(toolArgs, ctx.organizationId, id)
        case "get_contract":
          return toolGetContract(toolArgs, ctx.organizationId, id)
        case "create_contract":
          if (ctx.scopes && !ctx.scopes.includes("write")) {
            return toolError(id, "Error: API key is read-only — write scope required")
          }
          return toolCreateContract(toolArgs, ctx.organizationId, ctx.userId, id)
        case "list_contracts":
          return toolListContracts(toolArgs, ctx.organizationId, id)
        case "semantic_search":
          return toolSemanticSearch(toolArgs, ctx.organizationId, id)
        case "ask_contract":
          return toolAskContract(toolArgs, ctx.organizationId, id)
        // M7 Obligations
        case "list_obligations":
          return toolListObligations(toolArgs, ctx.organizationId, id)
        case "create_obligation":
          if (ctx.scopes && !ctx.scopes.includes("write")) {
            return toolError(id, "Error: API key is read-only — write scope required")
          }
          return toolCreateObligation(toolArgs, ctx.organizationId, ctx.userId, id)
        case "update_obligation":
          if (ctx.scopes && !ctx.scopes.includes("write")) {
            return toolError(id, "Error: API key is read-only — write scope required")
          }
          return toolUpdateObligation(toolArgs, ctx.organizationId, ctx.userId, id)
        // M8 Analytics
        case "get_analytics_summary":
          return toolGetAnalyticsSummary(ctx.organizationId, id)
        // M9 CRM
        case "list_crm_links":
          return toolListCrmLinks(toolArgs, ctx.organizationId, id)
        // M10 Import
        case "list_import_jobs":
          return toolListImportJobs(toolArgs, ctx.organizationId, id)
        case "get_import_job":
          return toolGetImportJob(toolArgs, ctx.organizationId, id)
        default:
          return toolError(id, `Error: Unknown tool "${toolName}"`)
      }
    }

    // Unknown method
    return jsonRpcError(id, -32601, "Method not found")
  })
}

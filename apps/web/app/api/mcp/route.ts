import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { generateEmbedding } from "@/lib/embedding"
import { QA_SYSTEM_PROMPT } from "@/lib/ai/prompts"
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
            AND to_tsvector('english',
              coalesce(title, '') || ' ' ||
              coalesce("counterpartyName", '') || ' ' ||
              coalesce(notes, '') || ' ' ||
              coalesce("extractedText", '')
            ) @@ plainto_tsquery('english', ${q})
          ORDER BY ts_rank(
            to_tsvector('english',
              coalesce(title, '') || ' ' ||
              coalesce("counterpartyName", '') || ' ' ||
              coalesce(notes, '') || ' ' ||
              coalesce("extractedText", '')
            ),
            plainto_tsquery('english', ${q})
          ) DESC
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
  const parsed = CreateContractSchema.safeParse(args)
  if (!parsed.success) {
    return toolError(id, `Invalid arguments: ${JSON.stringify(parsed.error.flatten())}`)
  }

  const { startDate, endDate, ...rest } = parsed.data

  const contract = await prisma.contract.create({
    data: {
      ...rest,
      owner: { connect: { id: userId } },
      organization: { connect: { id: orgId } },
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    } as any,
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
  if (status) where.status = status
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
    if (process.env.ANTHROPIC_API_KEY) {
      const Anthropic = (await import("@anthropic-ai/sdk")).default
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
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

// ---------------------------------------------------------------------------
// Main POST handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return new Response("Unauthorized", { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response("Invalid JSON", { status: 400 })
  }

  // Validate JSON-RPC envelope
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
          return toolCreateContract(toolArgs, ctx.organizationId, ctx.userId, id)
        case "list_contracts":
          return toolListContracts(toolArgs, ctx.organizationId, id)
        case "semantic_search":
          return toolSemanticSearch(toolArgs, ctx.organizationId, id)
        case "ask_contract":
          return toolAskContract(toolArgs, ctx.organizationId, id)
        default:
          return toolError(id, `Error: Unknown tool "${toolName}"`)
      }
    }

    // Unknown method
    return jsonRpcError(id, -32601, "Method not found")
  })
}

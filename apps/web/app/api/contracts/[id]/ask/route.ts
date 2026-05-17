import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { QA_SYSTEM_PROMPT } from "@/lib/ai/prompts"
import { generateEmbedding } from "@/lib/embedding"
import { chunkText } from "@/lib/ai/chunking"
import { resolveAiConfig, withAiConfigCache } from "@/lib/ai/resolve"
import { logger } from "@/lib/logger"
import Anthropic from "@anthropic-ai/sdk"
import { Prisma } from "@prisma/client"
import { z } from "zod"

const AskSchema = z.object({
  question: z.string().min(1).max(2000),
})

async function callQaLLM(
  contractTitle: string,
  contextText: string,
  question: string,
  organizationId: string,
): Promise<string | null> {
  // Wrap user-controlled values in structural delimiters so the model can
  // distinguish trusted instructions from untrusted user input. The system
  // prompt instructs the model to ignore any instructions embedded inside
  // the <user_question> tag.
  const userContent =
    `<contract_title>${contractTitle}</contract_title>\n\n` +
    `Relevant contract excerpts:\n${contextText}\n\n` +
    `<user_question>${question}</user_question>`

  const aiConfig = await resolveAiConfig(organizationId)

  if (aiConfig.provider === "anthropic" && aiConfig.apiKey) {
    const anthropic = new Anthropic({ apiKey: aiConfig.apiKey })
    const msg = await anthropic.messages.create({
      model: aiConfig.model ?? "claude-haiku-4-5",
      max_tokens: 1024,
      system: QA_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    })
    const block = msg.content.find((b) => b.type === "text")
    return block?.type === "text" ? block.text.trim() : null
  }

  if (aiConfig.provider === "openai" && aiConfig.apiKey) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: aiConfig.model ?? "gpt-4o-mini",
        max_tokens: 1024,
        messages: [
          { role: "system", content: QA_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`OpenAI chat API error ${res.status}: ${text}`)
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string | null } }>
    }
    return data.choices[0]?.message.content?.trim() ?? null
  }

  return null
}

type AskCitation = {
  chunkIndex: number
  text: string
  similarity: number | null
}

async function retrieveRelevantChunks(
  contractId: string,
  organizationId: string,
  extractedText: string,
  question: string,
): Promise<AskCitation[]> {
  const embedding = await generateEmbedding(question)
  if (!embedding) {
    return chunkText(extractedText, 8000, 1000)
      .slice(0, 5)
      .map((chunk) => ({ chunkIndex: chunk.index, text: chunk.text, similarity: null }))
  }

  const embeddingStr = `[${embedding.join(",")}]`
  type ChunkRow = {
    chunkIndex: number
    text: string
    similarity: number
  }

  // Match the recall/precision tradeoff used elsewhere in semantic search.
  await prisma.$executeRaw`SET ivfflat.probes = 10`

  // Defense in depth: even though contractId is org-scoped above, JOIN to
  // Contract and filter by organizationId so a chunk row can never be returned
  // for a different tenant.
  let rows: ChunkRow[] = []
  try {
    rows = await prisma.$queryRaw<ChunkRow[]>(
      Prisma.sql`
        SELECT
          cce."chunkIndex",
          cce."text",
          1 - (cce."embedding" <=> ${embeddingStr}::vector) AS similarity
        FROM "ContractChunkEmbedding" cce
        JOIN "Contract" c ON c."id" = cce."contractId"
        WHERE cce."contractId" = ${contractId}
          AND c."organizationId" = ${organizationId}
        ORDER BY cce."embedding" <=> ${embeddingStr}::vector
        LIMIT 5
      `,
    )
  } catch {
    // Table may not exist yet or pgvector extension not loaded.
    // Fall through to text-based chunking below.
  }

  if (rows.length > 0) {
    return rows.map((row) => ({
      chunkIndex: row.chunkIndex,
      text: row.text,
      similarity: row.similarity,
    }))
  }

  return chunkText(extractedText, 8000, 1000)
    .slice(0, 5)
    .map((chunk) => ({ chunkIndex: chunk.index, text: chunk.text, similarity: null }))
}

function buildContext(chunks: AskCitation[]): string {
  return chunks
    .map((chunk) => `[Excerpt ${chunk.chunkIndex + 1}]\n${chunk.text}`)
    .join("\n\n---\n\n")
    .slice(0, 50000)
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveAuth(req)
  if (!ctx) return new Response("Unauthorized", { status: 401 })

  // Rate limit: 20 requests/min per org (AI inference is costly)
  const rl = await rateLimit(`${ctx.organizationId}:ask`, 20, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter)

  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = AskSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { question } = parsed.data

  return withAiConfigCache(() => requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        extractedText: true,
        organizationId: true,
      },
    })

    if (!contract) {
      return Response.json({ error: "Contract not found" }, { status: 404 })
    }

    // Org-scope check — return 404 to avoid leaking resource existence
    if (contract.organizationId !== ctx.organizationId) {
      return Response.json({ error: "Contract not found" }, { status: 404 })
    }

    if (!contract.extractedText) {
      return Response.json(
        { error: "No extracted text available for this contract" },
        { status: 400 },
      )
    }

    // Quick check before spending time on retrieval
    const aiCfg = await resolveAiConfig(contract.organizationId)
    if (!aiCfg.provider) {
      return Response.json(
        { error: "No AI provider configured" },
        { status: 503 },
      )
    }

    let citations: AskCitation[]
    try {
      citations = await retrieveRelevantChunks(
        contract.id,
        contract.organizationId,
        contract.extractedText,
        question,
      )
    } catch (err) {
      logger.error({ err, contractId: id }, "[ask] Retrieval failed for contract")
      return Response.json({ error: "Retrieval failed" }, { status: 503 })
    }

    if (citations.length === 0) {
      return Response.json(
        { error: "No usable contract text available for this contract" },
        { status: 400 },
      )
    }

    let answer: string | null
    try {
      answer = await callQaLLM(contract.title, buildContext(citations), question, contract.organizationId)
    } catch (err) {
      logger.error({ err, contractId: id }, "[ask] LLM call failed for contract")
      return Response.json({ error: "AI call failed" }, { status: 503 })
    }

    if (!answer) {
      return Response.json({ error: "No AI provider configured" }, { status: 503 })
    }

    return Response.json({
      answer,
      contractId: contract.id,
      contractTitle: contract.title,
      citations,
    })
  }))
}

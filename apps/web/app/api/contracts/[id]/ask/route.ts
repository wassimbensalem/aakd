import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { QA_SYSTEM_PROMPT } from "@/lib/ai/prompts"
import { generateEmbedding } from "@/lib/embedding"
import { chunkText } from "@/lib/ai/chunking"
import { Prisma } from "@prisma/client"
import { z } from "zod"

const AskSchema = z.object({
  question: z.string().min(1).max(2000),
})

async function callQaLLM(
  contractTitle: string,
  contextText: string,
  question: string,
): Promise<string | null> {
  const userContent = `Contract: ${contractTitle}\n\nRelevant contract excerpts:\n${contextText}\n\nQuestion: ${question}`

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
    return block?.type === "text" ? block.text.trim() : null
  }

  if (process.env.OPENAI_API_KEY) {
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

  const rows = await prisma.$queryRaw<ChunkRow[]>(
    Prisma.sql`
      SELECT
        "chunkIndex",
        "text",
        1 - ("embedding" <=> ${embeddingStr}::vector) AS similarity
      FROM "ContractChunkEmbedding"
      WHERE "contractId" = ${contractId}
      ORDER BY "embedding" <=> ${embeddingStr}::vector
      LIMIT 5
    `,
  )

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
  const rl = rateLimit(`${ctx.organizationId}:ask`, 20, 60_000)
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

  return requestContext.run(ctx, async () => {
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

    if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
      return Response.json(
        { error: "No AI provider configured" },
        { status: 503 },
      )
    }

    let citations: AskCitation[]
    try {
      citations = await retrieveRelevantChunks(contract.id, contract.extractedText, question)
    } catch (err) {
      console.error(`[ask] Retrieval failed for contract ${id}:`, err)
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
      answer = await callQaLLM(contract.title, buildContext(citations), question)
    } catch (err) {
      console.error(`[ask] LLM call failed for contract ${id}:`, err)
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
  })
}

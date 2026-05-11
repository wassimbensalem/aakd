import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"

const ROLES_CAN_WRITE = new Set(["admin", "legal", "member"])

const OBLIGATION_EXTRACTION_PROMPT = `You are a contract analysis assistant. Identify all obligations, commitments, deliverables, and deadlines in this contract.

Return ONLY a valid JSON array. Each item must have this exact shape:
{
  "title": <short obligation title, max 100 chars>,
  "description": <1-2 sentence description of the obligation>,
  "clauseReference": <clause/section reference e.g. "Section 4.2" or null>,
  "priority": <"HIGH" | "MEDIUM" | "LOW" — HIGH for payment/penalty/termination obligations>,
  "suggestedDueDays": <number of days from today to suggest as due date, integer 1-365, use 30 if unclear>
}

Return ONLY the JSON array. No explanation, no markdown fences. Max 20 obligations.`

let _anthropic: Anthropic | null = null
function getAnthropic(): Anthropic {
  return (_anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }))
}

let _openai: OpenAI | null = null
function getOpenAI(): OpenAI {
  return (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))
}

async function callObligationLLM(text: string): Promise<string | null> {
  const provider =
    process.env.AI_PROVIDER?.toLowerCase() ||
    (process.env.ANTHROPIC_API_KEY
      ? "anthropic"
      : process.env.OPENAI_API_KEY
        ? "openai"
        : process.env.OLLAMA_BASE_URL
          ? "ollama"
          : null)

  if (!provider) return null

  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) return null
    const msg = await getAnthropic().messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
      max_tokens: 2048,
      system: OBLIGATION_EXTRACTION_PROMPT,
      messages: [{ role: "user", content: `Here is the contract text to analyze:\n\n${text}` }],
    })
    const block = msg.content.find((b) => b.type === "text")
    return block?.type === "text" ? block.text.trim() : ""
  }

  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) return null
    const res = await getOpenAI().chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      max_tokens: 2048,
      messages: [
        { role: "system", content: OBLIGATION_EXTRACTION_PROMPT },
        { role: "user", content: `Here is the contract text to analyze:\n\n${text}` },
      ],
    })
    return res.choices[0]?.message.content?.trim() ?? ""
  }

  if (provider === "ollama") {
    const base = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "")
    const model = process.env.OLLAMA_MODEL ?? "llama3"
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: "system", content: OBLIGATION_EXTRACTION_PROMPT },
          { role: "user", content: `Here is the contract text to analyze:\n\n${text}` },
        ],
      }),
    })
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`)
    const data = (await res.json()) as { message?: { content?: string } }
    return data.message?.content?.trim() ?? ""
  }

  return null
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  if (!ROLES_CAN_WRITE.has(ctx.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  return requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true, extractedText: true, status: true },
    })

    if (!contract || contract.organizationId !== ctx.organizationId) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    if (!contract.extractedText) {
      return Response.json({ error: "no_extracted_text" }, { status: 422 })
    }

    const provider =
      process.env.AI_PROVIDER?.toLowerCase() ||
      (process.env.ANTHROPIC_API_KEY
        ? "anthropic"
        : process.env.OPENAI_API_KEY
          ? "openai"
          : process.env.OLLAMA_BASE_URL
            ? "ollama"
            : null)

    if (!provider) {
      return Response.json({ error: "no_ai_provider" }, { status: 422 })
    }

    const truncated = contract.extractedText.slice(0, 100_000)

    let raw: string | null
    try {
      raw = await callObligationLLM(truncated)
    } catch (err) {
      console.error("[obligations/extract] LLM call failed:", err)
      return Response.json({ error: "llm_error" }, { status: 500 })
    }

    if (!raw) {
      return Response.json({ error: "no_ai_provider" }, { status: 422 })
    }

    let suggestions: unknown
    try {
      suggestions = JSON.parse(raw)
    } catch {
      console.error("[obligations/extract] Failed to parse LLM response:", raw)
      return Response.json({ error: "parse_error" }, { status: 500 })
    }

    return Response.json({ suggestions })
  })
}

import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { resolveAiConfig } from "@/lib/ai/resolve"
import { logger } from "@/lib/logger"
import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"

const RISK_SYSTEM_PROMPT = `You are a contract risk analyzer. Analyze the contract text and return ONLY a valid JSON object with this exact shape:

{
  "overall": "LOW" | "MEDIUM" | "HIGH",
  "score": <integer 0-100>,
  "categories": {
    "liability": { "level": "LOW"|"MEDIUM"|"HIGH", "finding": "<1 sentence>", "clause": "<verbatim quote or null>" },
    "termination": { "level": "LOW"|"MEDIUM"|"HIGH", "finding": "<1 sentence>", "clause": "<verbatim quote or null>" },
    "autoRenewal": { "level": "LOW"|"MEDIUM"|"HIGH", "finding": "<1 sentence>", "clause": "<verbatim quote or null>" },
    "ipOwnership": { "level": "LOW"|"MEDIUM"|"HIGH", "finding": "<1 sentence>", "clause": "<verbatim quote or null>" },
    "paymentTerms": { "level": "LOW"|"MEDIUM"|"HIGH", "finding": "<1 sentence>", "clause": "<verbatim quote or null>" },
    "governingLaw": { "level": "LOW"|"MEDIUM"|"HIGH", "finding": "<1 sentence>", "clause": "<verbatim quote or null>" }
  },
  "summary": "<2-3 sentence overall risk summary>"
}

Risk level guidelines:
- HIGH: uncapped liability, auto-renewal with no notice, IP fully assigned to counterparty, payment net-90+, no governing law
- LOW: standard mutual terms, capped liability, reasonable notice period, clear governing law
- MEDIUM: anything between
Return ONLY the JSON, no markdown.`

function getAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey })
}

function getOpenAIClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey })
}

async function callAiForRiskScore(text: string, organizationId: string): Promise<unknown | null> {
  const aiConfig = await resolveAiConfig(organizationId)
  const truncated = text.slice(0, 60_000)

  if (aiConfig.provider === "anthropic" && aiConfig.apiKey) {
    const client = getAnthropicClient(aiConfig.apiKey)
    try {
      const msg = await client.messages.create({
        model: aiConfig.model ?? "claude-3-5-haiku-latest",
        max_tokens: 1024,
        system: RISK_SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Contract text:\n\n${truncated}` }],
      }, { signal: AbortSignal.timeout(30_000) })
      const raw = msg.content.find((b) => b.type === "text")?.text ?? null
      if (!raw) return null
      return JSON.parse(raw)
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return null
      throw err
    }
  }

  if (aiConfig.provider === "openai" && aiConfig.apiKey) {
    const client = getOpenAIClient(aiConfig.apiKey)
    try {
      const resp = await client.chat.completions.create({
        model: aiConfig.model ?? "gpt-4o-mini",
        messages: [
          { role: "system", content: RISK_SYSTEM_PROMPT },
          { role: "user", content: `Contract text:\n\n${truncated}` },
        ],
        response_format: { type: "json_object" },
      }, { signal: AbortSignal.timeout(30_000) })
      const raw = resp.choices[0]?.message?.content ?? null
      if (!raw) return null
      return JSON.parse(raw)
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return null
      throw err
    }
  }

  if (aiConfig.provider === "ollama") {
    const ollamaBase = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"
    const ollamaModel = aiConfig.model ?? "llama3.1"
    const res = await fetch(`${ollamaBase}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel,
        prompt: `${RISK_SYSTEM_PROMPT}\n\nContract text:\n\n${truncated}`,
        stream: false,
        format: "json",
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return JSON.parse(data.response ?? "{}")
  }

  return null
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const rl = await rateLimit(`${ctx.organizationId}:risk-score`, 10, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter)

  return requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findFirst({
      where: { id: params.id, organizationId: ctx.organizationId },
      select: { id: true, extractedText: true, organizationId: true },
    })

    if (!contract) return Response.json({ error: "Not found" }, { status: 404 })

    if (!contract.extractedText) {
      return Response.json({ error: "No extracted text — upload and process a document first" }, { status: 400 })
    }

    const aiConfig = await resolveAiConfig(contract.organizationId)
    if (!aiConfig.provider) {
      return Response.json({ error: "No AI provider configured" }, { status: 503 })
    }

    let riskDetails: unknown
    try {
      riskDetails = await callAiForRiskScore(contract.extractedText, contract.organizationId)
    } catch (err) {
      logger.error("[risk-score] AI call failed", err)
      return Response.json({ error: "AI provider error" }, { status: 502 })
    }

    if (!riskDetails || typeof riskDetails !== "object") {
      return Response.json({ error: "AI returned invalid response" }, { status: 502 })
    }

    const details = riskDetails as { overall?: string; score?: number }
    const riskScore = details.overall ?? null
    const riskScoredAt = new Date()

    await prisma.contract.update({
      where: { id: params.id },
      data: {
        riskScore,
        riskScoredAt,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        riskDetails: riskDetails as any,
      },
    })

    await writeActivity(
      params.id,
      ctx.userId,
      "METADATA_EXTRACTED",
      `Risk score computed: ${riskScore ?? "UNKNOWN"}`,
    )

    return Response.json({ riskScore, riskScoredAt, riskDetails }, { status: 200 })
  })
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findFirst({
      where: { id: params.id, organizationId: ctx.organizationId },
      select: { riskScore: true, riskScoredAt: true, riskDetails: true },
    })

    if (!contract) return Response.json({ error: "Not found" }, { status: 404 })

    return Response.json({
      riskScore: contract.riskScore,
      riskScoredAt: contract.riskScoredAt,
      riskDetails: contract.riskDetails,
    })
  })
}

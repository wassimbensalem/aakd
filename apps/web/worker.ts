/**
 * ClauseFlow BullMQ worker process.
 * Run with: npx tsx worker.ts
 * Dev watch: tsx watch worker.ts
 *
 * This is a standalone Node.js process — it does not run inside Next.js.
 * Env vars are loaded from .env.local (same directory).
 */
import * as dotenv from "dotenv"
import path from "path"

// Load env before any other imports that read process.env
dotenv.config({ path: path.resolve(__dirname, ".env.local") })

import { Worker, Job } from "bullmq"
import { PDFParse } from "pdf-parse"
import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { storage } from "@/lib/storage"
import type { ContractExtractJobData, ContractAiExtractJobData } from "@/lib/jobs/queues"
import { contractAiExtractQueue } from "@/lib/jobs/queues"

// ─── Redis connection ─────────────────────────────────────────────────────────

const connection = {
  url: process.env.REDIS_URL ?? "redis://localhost:6379",
}

// ─── Extraction prompt ────────────────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are a contract analysis assistant. Extract the following fields from the contract text provided. Return ONLY a valid JSON object with exactly these keys. Use null for any field you cannot determine with confidence.

Fields to extract:
- contractType: one of "NDA" | "MSA" | "SOW" | "EMPLOYMENT" | "VENDOR" | "CUSTOMER" | "OTHER" or null
- startDate: ISO 8601 date string (YYYY-MM-DD) or null
- endDate: ISO 8601 date string (YYYY-MM-DD) or null
- renewalDate: ISO 8601 date string (YYYY-MM-DD) or null
- value: numeric contract value (number) or null
- currency: 3-letter ISO currency code (e.g. "USD", "EUR") or null
- counterpartyName: name of the counterparty organization or individual (string) or null
- governingLaw: governing law / jurisdiction (string) or null
- noticePeriodDays: notice period in days (integer) or null
- autoRenewal: whether the contract auto-renews (boolean) or null

Return ONLY the JSON object, no explanation, no markdown fences.`

// ─── Worker: contract.extract ─────────────────────────────────────────────────

const extractWorker = new Worker<ContractExtractJobData>(
  "contract.extract",
  async (job: Job<ContractExtractJobData>) => {
    const { contractId, fileId, storageKey } = job.data

    console.log(`[extract] Processing job ${job.id} for contract ${contractId}, file ${fileId}`)

    // 1. Look up the ContractFile to get the mimeType and filename
    const contractFile = await prisma.contractFile.findUnique({
      where: { id: fileId },
      select: { mimeType: true, filename: true },
    })

    if (!contractFile) {
      console.warn(`[extract] ContractFile ${fileId} not found — skipping`)
      return
    }

    // 2. Download file bytes via signed URL
    const signedUrl = await storage.getSignedDownloadUrl(storageKey)
    const response = await fetch(signedUrl)
    if (!response.ok) {
      throw new Error(`Failed to download file from storage: ${response.status} ${response.statusText}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // 3. Extract text based on mime type
    let extractedText: string | null = null

    if (contractFile.mimeType === "application/pdf") {
      try {
        const parser = new PDFParse({ data: buffer })
        const result = await parser.getText()
        extractedText = result.text?.trim() ?? null
        console.log(`[extract] PDF text extracted: ${extractedText?.length ?? 0} chars`)
      } catch (err) {
        console.error(`[extract] pdf-parse failed for file ${fileId}:`, err)
        throw err
      }
    } else if (
      contractFile.mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      console.warn(
        `[extract] DOCX extraction not yet implemented for file ${fileId} (${contractFile.filename}) — skipping text extraction`,
      )
      // Best-effort: leave extractedText null for now; will be added in a later milestone.
    } else {
      console.warn(`[extract] Unsupported mime type ${contractFile.mimeType} for file ${fileId}`)
    }

    // 4. Persist extracted text to the Contract record
    if (extractedText) {
      await prisma.contract.update({
        where: { id: contractId },
        data: { extractedText },
      })

      await writeActivity(
        contractId,
        null,
        "METADATA_EXTRACTED",
        `Text extracted from ${contractFile.filename}`,
      )

      // 5. Enqueue AI extraction job
      await contractAiExtractQueue.add("ai_extract", { contractId, extractedText })
      console.log(`[extract] Enqueued ai_extract job for contract ${contractId}`)
    }
  },
  { connection },
)

extractWorker.on("completed", (job) =>
  console.log(`[extract] Job ${job.id} completed`),
)
extractWorker.on("failed", (job, err) =>
  console.error(`[extract] Job ${job?.id} failed:`, err),
)

// ─── Provider abstraction ─────────────────────────────────────────────────────
// Set AI_PROVIDER=anthropic|openai|ollama in .env.local
// Defaults to anthropic if ANTHROPIC_API_KEY is set, then openai, then ollama.

async function callExtractionLLM(text: string): Promise<string | null> {
  const provider = process.env.AI_PROVIDER?.toLowerCase()
    ?? (process.env.ANTHROPIC_API_KEY ? "anthropic"
      : process.env.OPENAI_API_KEY     ? "openai"
      : process.env.OLLAMA_BASE_URL    ? "ollama"
      : null)

  if (!provider) {
    console.warn("[ai_extract] No AI provider configured — set AI_PROVIDER or one of ANTHROPIC_API_KEY / OPENAI_API_KEY / OLLAMA_BASE_URL")
    return null
  }

  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) { console.warn("[ai_extract] AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set"); return null }
    const anthropic = new Anthropic({ apiKey: key })
    const msg = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
      max_tokens: 1024,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Here is the contract text to analyze:\n\n${text}` }],
    })
    const block = msg.content.find((b) => b.type === "text")
    return block?.type === "text" ? block.text.trim() : ""
  }

  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY
    if (!key) { console.warn("[ai_extract] AI_PROVIDER=openai but OPENAI_API_KEY is not set"); return null }
    const openai = new OpenAI({ apiKey: key })
    const res = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      max_tokens: 1024,
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
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
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: `Here is the contract text to analyze:\n\n${text}` },
        ],
      }),
    })
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`)
    const data = await res.json() as { message?: { content?: string } }
    return data.message?.content?.trim() ?? ""
  }

  console.warn(`[ai_extract] Unknown AI_PROVIDER="${provider}"`)
  return null
}

// ─── Worker: contract.ai_extract ─────────────────────────────────────────────

const aiExtractWorker = new Worker<ContractAiExtractJobData>(
  "contract.ai_extract",
  async (job: Job<ContractAiExtractJobData>) => {
    const { contractId, extractedText } = job.data

    console.log(`[ai_extract] Processing job ${job.id} for contract ${contractId}`)

    // Truncate to ~25k tokens
    const textToAnalyze =
      extractedText.length > 100_000 ? extractedText.slice(0, 100_000) : extractedText

    let rawJson: string
    try {
      const result = await callExtractionLLM(textToAnalyze)
      if (result === null) return
      rawJson = result
    } catch (err) {
      console.error(`[ai_extract] LLM call failed for contract ${contractId}:`, err)
      return
    }

    // Parse the JSON response
    let extracted: Record<string, unknown>
    try {
      extracted = JSON.parse(rawJson)
    } catch {
      console.error(
        `[ai_extract] Failed to parse LLM response as JSON for contract ${contractId}:`,
        rawJson,
      )
      return
    }

    // Fields we want to upsert into AIExtraction
    const EXTRACTABLE_FIELDS = [
      "contractType",
      "startDate",
      "endDate",
      "renewalDate",
      "value",
      "currency",
      "counterpartyName",
      "governingLaw",
      "noticePeriodDays",
      "autoRenewal",
    ]

    const nonNullFields = EXTRACTABLE_FIELDS.filter(
      (field) => extracted[field] !== null && extracted[field] !== undefined,
    )

    if (nonNullFields.length === 0) {
      console.log(`[ai_extract] No fields extracted for contract ${contractId}`)
      return
    }

    // Upsert AIExtraction records in a transaction
    await prisma.$transaction(
      nonNullFields.map((field) =>
        prisma.aIExtraction.upsert({
          where: { contractId_field: { contractId, field } },
          create: {
            contractId,
            field,
            rawValue: String(extracted[field]),
            confidence: 0.85,
            extractedBy: "ai",
            status: "pending",
          },
          update: {
            rawValue: String(extracted[field]),
            confidence: 0.85,
            status: "pending",
          },
        }),
      ),
    )

    await writeActivity(
      contractId,
      null,
      "METADATA_EXTRACTED",
      `AI extracted ${nonNullFields.length} fields`,
    )

    console.log(
      `[ai_extract] Upserted ${nonNullFields.length} extraction records for contract ${contractId}: ${nonNullFields.join(", ")}`,
    )
  },
  { connection },
)

aiExtractWorker.on("completed", (job) =>
  console.log(`[ai_extract] Job ${job.id} completed`),
)
aiExtractWorker.on("failed", (job, err) =>
  console.error(`[ai_extract] Job ${job?.id} failed:`, err),
)

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown() {
  console.log("[worker] Shutting down gracefully…")
  await extractWorker.close()
  await aiExtractWorker.close()
  await contractAiExtractQueue.close()
  await prisma.$disconnect()
  process.exit(0)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

console.log("[worker] ClauseFlow BullMQ worker started")
console.log(`[worker] Redis: ${process.env.REDIS_URL ?? "redis://localhost:6379"}`)
const _provider = process.env.AI_PROVIDER
  ?? (process.env.ANTHROPIC_API_KEY ? "anthropic"
    : process.env.OPENAI_API_KEY     ? "openai"
    : process.env.OLLAMA_BASE_URL    ? "ollama"
    : "none")
console.log(`[worker] AI provider: ${_provider}`)

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

// Initialise OTel after dotenv so env vars are available, before any
// instrumented libraries (ioredis, Prisma) are used.
import { initOtel } from "./lib/otel"
initOtel("clauseflow-worker")

import crypto from "node:crypto"
import { promisify } from "node:util"
import { exec } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import { Worker, Job } from "bullmq"
import pdfParse from "pdf-parse"
import mammoth from "mammoth"
import libre from "libreoffice-convert"
import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { logger } from "@/lib/logger"
import { getWorkerPrisma } from "@/lib/db/worker-client"
import { prisma as appPrisma } from "@/lib/db/client"
import { storage } from "@/lib/storage"
import { checkAndFireAlerts } from "@/lib/alerts/check"
import { generateEmbedding, currentEmbeddingModel } from "@/lib/embedding"
// getSubmission and isAllowedDocuSealUrl moved to worker/jobs/signing-sync.ts
import { chunkText } from "@/lib/ai/chunking"
import { sendAlertEmailById } from "@/lib/email"
import { sendApprovalRequestEmail, sendApprovalRejectionEmail } from "@/lib/email/approval"
import { sendEventNotificationEmail } from "@/lib/email/event-notification"
import { sendSlackEvent, sendTeamsEvent } from "@/lib/notifications/webhooks"
import { decrypt } from "@/lib/notifications/crypto"
import { buildUnsubscribeToken } from "@/lib/notifications/unsubscribe-token"
import {
  DEFAULT_EMAIL_ENABLED,
  WEBHOOK_API_VERSION,
  type NotificationEventName,
} from "@/lib/notifications/fanout"
import { enqueueNotification } from "@/lib/notifications/fanout"
import type {
  ContractExtractJobData,
  ContractAiExtractJobData,
  AlertsCheckJobData,
  ContractEmbedJobData,
  SigningSyncJobData,
  EmailJobData,
  NotificationFanoutJobData,
  NotificationDeliverJobData,
  DocumentConvertJobData,
  DocumentExportJobData,
  ObligationsCheckJobData,
  ImportProcessJobData,
  ObligationExtractJobData,
} from "@/lib/jobs/queues"
import {
  contractExtractQueue,
  contractAiExtractQueue,
  contractEmbedQueue,
  alertsCheckQueue,
  signingSyncQueue,
  emailQueue,
  notificationFanoutQueue,
  notificationDeliverQueue,
  documentConvertQueue,
  documentExportQueue,
  obligationsCheckQueue,
  salesforcePollQueue,
  importProcessQueue,
  getObligationExtractQueue,
  obligationExtractQueue,
} from "@/lib/jobs/queues"
import type { SalesforcePollJobData } from "@/lib/jobs/queues"
import { processImportJob } from "@/lib/import/processor"
import { getCrmProvider } from "@/lib/crm"
import { encryptToken } from "@/lib/crm/crypto"
import { htmlToPlateNodes } from "@/lib/editor/html-to-plate"
import { plateToPlaintext, countWords, plaintextToPlateNodes } from "@/lib/editor/plate-to-plaintext"
import { plateToDocxBuffer } from "@/lib/editor/plate-to-docx"
import { plateToPdfBuffer } from "@/lib/editor/plate-to-pdf"
import { createSigningSyncWorker } from "../../worker/jobs/signing-sync"

// ─── Boot check: notification encryption key ─────────────────────────────────
// Refuse to start if the key is missing — silently storing plaintext URLs and
// signing secrets would be a serious security regression.
if (!process.env.NOTIFICATION_ENCRYPTION_KEY) {
  throw new Error("NOTIFICATION_ENCRYPTION_KEY is required")
}

// ─── Migration readiness check ────────────────────────────────────────────────
// The worker and app containers start concurrently. If the worker boots before
// `prisma migrate deploy` completes in the app container, it will query with a
// stale schema and fail. Poll until the _prisma_migrations table is readable.

async function waitForMigrations(maxWaitMs = 60_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    try {
      await getWorkerPrisma().$queryRaw`SELECT 1 FROM "_prisma_migrations" LIMIT 1`
      logger.info("[worker] database migrations verified — starting job workers")
      return
    } catch {
      logger.info("[worker] waiting for database migrations...")
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
  throw new Error("[worker] Database migrations did not complete within timeout")
}

// Non-blocking migration check — workers start immediately; BullMQ's
// exponential-backoff retry policy covers the window between container start
// and migration completion. If the check itself times out we exit hard.
waitForMigrations().catch((err: unknown) => {
  logger.error({ err }, "[worker] Migration check failed — exiting")
  process.exit(1)
})

// ─── Redis connection ─────────────────────────────────────────────────────────

const connection = {
  url: process.env.REDIS_URL ?? "redis://localhost:6379",
}

function maskRedisUrl(url: string): string {
  return url.replace(/\/\/:([^@]+)@/, "//:***@")
}

// ─── SDK singletons ───────────────────────────────────────────────────────────
// Constructed lazily so dotenv has loaded before we read API keys.

let _anthropic: Anthropic | null = null
function getAnthropic(): Anthropic {
  return (_anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }))
}

let _openai: OpenAI | null = null
function getOpenAI(): OpenAI {
  return (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))
}

// ─── LibreOffice PDF→DOCX conversion helper ───────────────────────────────────
// Converts a PDF buffer to DOCX using the local LibreOffice install.
// Returns null if LibreOffice is unavailable or the conversion fails, so callers
// can fall back to plain-text extraction without aborting the job.

const libreConvert = promisify(libre.convert)
const execAsync = promisify(exec)

// ─── OCR helper ───────────────────────────────────────────────────────────────
// Attempts OCR on a PDF buffer.
// Strategy 1: pdftoppm CLI (in the Docker image) → per-page PNGs → tesseract.js
// Strategy 2: tesseract.js directly on the raw buffer (limited support)
// Returns OCR text prefixed with "[OCR] ", or null if all methods fail.

async function attemptOcr(buffer: Buffer): Promise<string | null> {
  // Check if pdftoppm is available
  let pdftoppmAvailable = false
  try {
    await execAsync("which pdftoppm")
    pdftoppmAvailable = true
  } catch {
    pdftoppmAvailable = false
  }

  let ocrText = ""

  if (pdftoppmAvailable) {
    // Strategy 1: pdftoppm → page images → tesseract
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clauseflow-ocr-"))
    const pdfPath = path.join(tmpDir, "input.pdf")
    try {
      await fs.writeFile(pdfPath, buffer)
      // Render each page to PNG at 150 DPI
      await execAsync(`pdftoppm -png -r 150 "${pdfPath}" "${path.join(tmpDir, "page")}"`)
      const files = (await fs.readdir(tmpDir))
        .filter((f) => f.endsWith(".png"))
        .sort()

      if (files.length === 0) {
        logger.warn("[ocr] pdftoppm produced no page images")
      } else {
        const { createWorker } = await import("tesseract.js")
        const tWorker = await createWorker("eng")
        for (const fname of files) {
          const imgBuffer = await fs.readFile(path.join(tmpDir, fname))
          const { data } = await tWorker.recognize(imgBuffer)
          if (data.text) ocrText += data.text + "\n"
        }
        await tWorker.terminate()
      }
    } catch (err) {
      logger.warn({ err }, "[ocr] pdftoppm+tesseract strategy failed")
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  } else {
    // Strategy 2: tesseract directly on PDF buffer (limited but dependency-free)
    try {
      const { createWorker } = await import("tesseract.js")
      const tWorker = await createWorker("eng")
      const { data } = await tWorker.recognize(buffer)
      ocrText = data.text ?? ""
      await tWorker.terminate()
    } catch (err) {
      logger.warn({ err }, "[ocr] tesseract direct-PDF strategy failed")
      return null
    }
  }

  const cleaned = ocrText.trim()
  if (!cleaned || cleaned.length < 50) return null
  return `[OCR] ${cleaned}`
}

async function pdfToDocxBuffer(pdfBuffer: Buffer): Promise<Buffer | null> {
  try {
    const result = await libreConvert(pdfBuffer, ".docx", undefined)
    return result as Buffer
  } catch (err) {
    logger.warn({ err }, "[import] LibreOffice PDF→DOCX failed, falling back to text")
    return null
  }
}

// ─── Extraction prompt ────────────────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are a contract analysis assistant. Extract the following fields from the contract text provided. Return ONLY a valid JSON object where each key maps to an object with this exact shape:

{ "value": <field value or null>, "confidence": <number between 0 and 1>, "sourceText": <exact quote from the contract supporting the value, or null>, "sourcePage": <1-indexed page number where the quote appears, or null> }

Use null for the "value" of any field you cannot determine. When "value" is null, set "confidence" to 0 and "sourceText"/"sourcePage" to null. "sourceText" must be a verbatim substring of the contract — do not paraphrase. "confidence" must reflect how certain you are that the extracted value is correct: 1 = explicit and unambiguous, 0.5 = inferred, 0 = unknown.

Fields to extract (each with the shape above):
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

Example output:
{
  "contractType": { "value": "NDA", "confidence": 0.95, "sourceText": "This Mutual Non-Disclosure Agreement", "sourcePage": 1 },
  "startDate": { "value": "2025-01-15", "confidence": 0.9, "sourceText": "Effective Date: January 15, 2025", "sourcePage": 1 },
  "value": { "value": null, "confidence": 0, "sourceText": null, "sourcePage": null }
}

Return ONLY the JSON object, no explanation, no markdown fences.`

// Per-provider character budget for the contract text we feed to the LLM.
// Roughly 4 chars per token; we leave headroom for prompt + JSON response.
function getTextLimitForProvider(): number {
  const provider = (process.env.AI_PROVIDER?.toLowerCase() || "").trim()
  if (provider === "ollama") return 32_000
  if (provider === "openai") return 400_000
  if (provider === "anthropic") return 600_000
  // Auto-detect when AI_PROVIDER is unset.
  if (process.env.ANTHROPIC_API_KEY) return 600_000
  if (process.env.OPENAI_API_KEY) return 400_000
  if (process.env.OLLAMA_BASE_URL) return 32_000
  return 100_000
}

// ─── Worker: contract.extract ─────────────────────────────────────────────────

const extractWorker = new Worker<ContractExtractJobData>(
  "contract.extract",
  async (job: Job<ContractExtractJobData>) => {
    const { contractId, fileId, storageKey } = job.data

    logger.info({ jobId: job.id, contractId, fileId }, "[extract] processing job")

    // Idempotency guard: if a previous run already extracted text and kicked
    // off the embed step, a retry would duplicate Activity rows and re-enqueue
    // contract.embed. Re-enqueue embed only if no embedding exists yet.
    const existingContract = await getWorkerPrisma().contract.findUnique({
      where: { id: contractId },
      select: { extractedText: true },
    })
    if (existingContract?.extractedText) {
      logger.info({ contractId }, "[extract] contract already has extracted text — skipping")
      return
    }

    // 1. Look up the ContractFile to get the mimeType and filename
    const contractFile = await getWorkerPrisma().contractFile.findUnique({
      where: { id: fileId },
      select: { mimeType: true, filename: true },
    })

    if (!contractFile) {
      logger.warn({ fileId, contractId }, "[extract] ContractFile not found — skipping")
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

    let isOcrExtracted = false

    if (contractFile.mimeType === "application/pdf") {
      try {
        const result = await pdfParse(buffer)
        extractedText = result.text?.trim() ?? null
        logger.debug({ fileId, chars: extractedText?.length ?? 0 }, "[extract] PDF text extracted")
      } catch (err) {
        // pdf-parse can throw on malformed/corrupted PDFs (e.g. "bad XRef entry").
        // Don't re-throw — fall through to the OCR path which may still succeed.
        logger.warn({ err, fileId, contractId }, "[extract] pdf-parse failed — will attempt OCR")
      }
      // If text is absent or suspiciously short (scanned/image PDF), attempt OCR
      if (!extractedText || extractedText.length < 100) {
        logger.info({ fileId, chars: extractedText?.length ?? 0 }, "[extract] PDF text thin — attempting OCR")
        const ocrResult = await attemptOcr(buffer)
        if (ocrResult) {
          extractedText = ocrResult
          isOcrExtracted = true
          logger.info({ fileId, chars: ocrResult.length }, "[extract] OCR succeeded")
        } else {
          logger.warn({ fileId, contractId }, "[extract] OCR also failed")
        }
      }
    } else if (
      contractFile.mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      try {
        const result = await mammoth.extractRawText({ buffer })
        extractedText = result.value?.trim() || null
        logger.debug({ fileId, chars: extractedText?.length ?? 0 }, "[extract] DOCX text extracted")
      } catch (err) {
        // Don't re-throw — null extractedText triggers the graceful "no text" path below.
        logger.error({ err, fileId, contractId }, "[extract] mammoth failed")
      }
    } else {
      logger.warn({ fileId, contractId, mimeType: contractFile.mimeType }, "[extract] unsupported mime type")
    }

    // 4. Persist extracted text to the Contract record
    if (extractedText) {
      await getWorkerPrisma().contract.update({
        where: { id: contractId },
        data: { extractedText, isOcrExtracted },
      })

      await getWorkerPrisma().activity.create({
        data: {
          contractId,
          userId: null,
          actorLabel: "System",
          action: "METADATA_EXTRACTED",
          detail: `Text extracted from ${contractFile.filename}${isOcrExtracted ? " (via OCR)" : ""}`,
        },
      })

      // 5. Enqueue embedding job. Spec: extract → embed → ai_extract. The
      // embed worker chains ai_extract once embeddings land so semantic search
      // is always populated even when the LLM extractor fails or is missing.
      await contractEmbedQueue.add("embed", { contractId, extractedText })
      logger.info({ contractId }, "[extract] enqueued embed job")
    } else {
      // Silent failures (typically scanned/image PDFs) used to disappear into
      // the void — log + write an Activity row so users see why downstream
      // AI features are missing.
      logger.warn({ fileId, contractId }, "[extract] no text extracted — likely a scanned image")
      await getWorkerPrisma().activity.create({
        data: {
          contractId,
          userId: null,
          actorLabel: "System",
          action: "METADATA_EXTRACTED",
          detail: "Text extraction failed — document may be a scanned image",
          metadata: { skipped: true, reason: "empty_text" },
        },
      })
    }
  },
  { connection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } } },
)

extractWorker.on("completed", (job) =>
  logger.info({ jobId: job.id }, "[extract] job completed"),
)
extractWorker.on("failed", (job, err) =>
  logger.error({ err, jobId: job?.id }, "[extract] job failed"),
)

// ─── Provider abstraction ─────────────────────────────────────────────────────
// Set AI_PROVIDER=anthropic|openai|ollama in .env.local
// Defaults to anthropic if ANTHROPIC_API_KEY is set, then openai, then ollama.

async function callExtractionLLM(text: string): Promise<string | null> {
  const provider = process.env.AI_PROVIDER?.toLowerCase() || (
    process.env.ANTHROPIC_API_KEY ? "anthropic"
      : process.env.OPENAI_API_KEY     ? "openai"
      : process.env.OLLAMA_BASE_URL    ? "ollama"
      : null
  )

  if (!provider) {
    logger.warn("[ai_extract] no AI provider configured — set AI_PROVIDER or one of ANTHROPIC_API_KEY / OPENAI_API_KEY / OLLAMA_BASE_URL")
    return null
  }

  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) { logger.warn("[ai_extract] AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set"); return null }
    const msg = await getAnthropic().messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
      max_tokens: 2048,
      temperature: 0, // structured extraction — deterministic output
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Here is the contract text to analyze:\n\n${text}` }],
    })
    const block = msg.content.find((b) => b.type === "text")
    return block?.type === "text" ? block.text.trim() : ""
  }

  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) { logger.warn("[ai_extract] AI_PROVIDER=openai but OPENAI_API_KEY is not set"); return null }
    const res = await getOpenAI().chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      max_tokens: 2048,
      temperature: 0, // structured extraction — deterministic output
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

  logger.warn({ provider }, "[ai_extract] unknown AI_PROVIDER")
  return null
}

// ─── Worker: contract.ai_extract ─────────────────────────────────────────────

const aiExtractWorker = new Worker<ContractAiExtractJobData>(
  "contract.ai_extract",
  async (job: Job<ContractAiExtractJobData>) => {
    const { contractId, extractedText } = job.data

    logger.info({ jobId: job.id, contractId }, "[ai_extract] processing job")

    const limit = getTextLimitForProvider()
    const textToAnalyze =
      extractedText.length > limit ? extractedText.slice(0, limit) : extractedText
    if (extractedText.length > limit) {
      logger.debug(
        { contractId, originalChars: extractedText.length, limitChars: limit, provider: process.env.AI_PROVIDER ?? "(auto)" },
        "[ai_extract] truncated contract text for provider",
      )
    }

    let rawJson: string
    try {
      const result = await callExtractionLLM(textToAnalyze)
      if (result === null) {
        logger.warn({ contractId }, "[ai_extract] extraction skipped — no AI provider configured")
        await getWorkerPrisma().activity.create({
          data: {
            contractId,
            userId: null,
            actorLabel: "System",
            action: "METADATA_EXTRACTED",
            detail: "AI extraction skipped — no AI provider configured",
            metadata: { skipped: true, reason: "no_provider" },
          },
        })
        return
      }
      rawJson = result
    } catch (err) {
      logger.error({ err, contractId }, "[ai_extract] LLM call failed")
      await getWorkerPrisma().activity.create({
        data: {
          contractId,
          userId: null,
          actorLabel: "System",
          action: "METADATA_EXTRACTED",
          detail: `AI extraction failed: ${(err as Error)?.message ?? String(err)}`,
          metadata: { skipped: true, reason: "llm_error" },
        },
      })
      return
    }

    // Strip markdown fences if the model emitted them despite instructions.
    const cleaned = rawJson
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim()

    let extracted: Record<string, unknown>
    try {
      extracted = JSON.parse(cleaned)
    } catch {
      logger.error(
        { contractId, rawJson: rawJson.slice(0, 200) },
        "[ai_extract] failed to parse LLM response as JSON",
      )
      await getWorkerPrisma().activity.create({
        data: {
          contractId,
          userId: null,
          actorLabel: "System",
          action: "METADATA_EXTRACTED",
          detail: "AI extraction failed: invalid JSON response",
          metadata: { skipped: true, reason: "parse_error" },
        },
      })
      return
    }

    type FieldExtraction = {
      value: unknown
      confidence: number
      sourceText: string | null
      sourcePage: number | null
    }

    function normalizeField(raw: unknown): FieldExtraction | null {
      // Legacy / lenient shape: bare scalar -> wrap with confidence 0
      if (raw === null || raw === undefined) return null
      if (typeof raw !== "object" || Array.isArray(raw)) {
        return { value: raw, confidence: 0, sourceText: null, sourcePage: null }
      }
      const obj = raw as Record<string, unknown>
      if (obj.value === null || obj.value === undefined) return null
      const conf = typeof obj.confidence === "number" ? obj.confidence : 0
      const clampedConf = Math.max(0, Math.min(1, conf))
      const src = typeof obj.sourceText === "string" && obj.sourceText.length > 0
        ? obj.sourceText
        : null
      const page = typeof obj.sourcePage === "number" && Number.isFinite(obj.sourcePage)
        ? Math.trunc(obj.sourcePage)
        : null
      return { value: obj.value, confidence: clampedConf, sourceText: src, sourcePage: page }
    }

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

    const fieldData = EXTRACTABLE_FIELDS
      .map((field) => ({ field, data: normalizeField(extracted[field]) }))
      .filter((entry): entry is { field: string; data: FieldExtraction } => entry.data !== null)

    if (fieldData.length === 0) {
      logger.info({ contractId }, "[ai_extract] no fields extracted")
      return
    }

    const db = getWorkerPrisma()
    // Two-step write: createMany skipDuplicates inserts only fields with no
    // prior row, then updateMany refreshes the rest — but only when the row
    // is NOT accepted. Without the status guard a re-run would clobber a
    // human-reviewed value back to "pending" and overwrite their edits.
    await db.aIExtraction.createMany({
      data: fieldData.map(({ field, data }) => ({
        contractId,
        field,
        rawValue: String(data.value),
        confidence: data.confidence,
        sourceText: data.sourceText,
        sourcePage: data.sourcePage,
        extractedBy: "ai",
        status: "pending",
      })),
      skipDuplicates: true,
    })

    for (const { field, data } of fieldData) {
      await db.aIExtraction.updateMany({
        where: { contractId, field, status: { not: "accepted" } },
        data: {
          rawValue: String(data.value),
          confidence: data.confidence,
          sourceText: data.sourceText,
          sourcePage: data.sourcePage,
          extractedBy: "ai",
          status: "pending",
        },
      })
    }

    await getWorkerPrisma().activity.create({
      data: { contractId, userId: null, actorLabel: "System", action: "METADATA_EXTRACTED", detail: `AI extracted ${fieldData.length} fields` },
    })

    logger.info(
      { contractId, count: fieldData.length, fields: fieldData.map((f) => f.field) },
      "[ai_extract] upserted extraction records",
    )

    // Fan out the contract.extracted event — system-actor (no user)
    await enqueueNotification("contract.extracted", contractId, null, {})
  },
  { connection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } } },
)

aiExtractWorker.on("completed", (job) =>
  logger.info({ jobId: job.id }, "[ai_extract] job completed"),
)
aiExtractWorker.on("failed", (job, err) =>
  logger.error({ err, jobId: job?.id }, "[ai_extract] job failed"),
)

// ─── Worker: contract.embed ───────────────────────────────────────────────────

const embedWorker = new Worker<ContractEmbedJobData>(
  "contract.embed",
  async (job: Job<ContractEmbedJobData>) => {
    const { contractId, extractedText } = job.data

    logger.info({ jobId: job.id, contractId }, "[embed] processing job")

    // ai_extract runs after embed in the spec'd pipeline (extract → embed →
    // ai_extract). It's independent of embeddings: chain it whether or not
    // embedding generation succeeds, so metadata still flows even when the
    // embedding provider is down or unconfigured.
    const chainAiExtract = () =>
      contractAiExtractQueue
        .add("ai_extract", { contractId, extractedText })
        .catch((err) =>
          logger.error({ err, contractId }, "[embed] failed to enqueue ai_extract"),
        )

    const embedding = await generateEmbedding(extractedText)
    if (!embedding) {
      logger.warn({ contractId }, "[embed] no embedding provider configured — skipping")
      await chainAiExtract()
      return
    }

    const db = getWorkerPrisma()
    const model = currentEmbeddingModel() ?? "unknown"
    const id = crypto.randomUUID()

    // Upsert using raw SQL (pgvector — Prisma does not support vector type natively)
    await db.$executeRaw`
      INSERT INTO "ContractEmbedding" ("id", "contractId", "embedding", "model", "createdAt", "updatedAt")
      VALUES (${id}, ${contractId}, ${JSON.stringify(embedding)}::vector, ${model}, NOW(), NOW())
      ON CONFLICT ("contractId") DO UPDATE
        SET "embedding" = EXCLUDED."embedding",
            "model" = EXCLUDED."model",
            "updatedAt" = NOW()
    `

    const chunks = chunkText(extractedText)

    // Collect first, then write. Previously we deleted existing rows and
    // inserted in-loop — a mid-loop failure left the contract with a partial
    // (or zero) chunk index, silently breaking semantic search.
    const collected: Array<{ index: number; text: string; embedding: number[] }> = []
    let failures = 0
    for (const chunk of chunks) {
      try {
        const chunkEmbedding = await generateEmbedding(chunk.text)
        if (!chunkEmbedding) {
          failures += 1
          continue
        }
        collected.push({ index: chunk.index, text: chunk.text, embedding: chunkEmbedding })
      } catch (err) {
        logger.error({ err, contractId, chunkIndex: chunk.index }, "[embed] chunk embedding failed")
        failures += 1
      }
    }

    if (collected.length === 0) {
      logger.warn(
        { contractId, totalChunks: chunks.length },
        "[embed] all chunk embeddings failed — leaving existing rows intact",
      )
      await db.activity.create({
        data: {
          contractId,
          userId: null,
          actorLabel: "System",
          action: "METADATA_EXTRACTED",
          detail: "Chunk embedding regeneration failed — existing search index preserved",
          metadata: { skipped: true, reason: "embedding_failed", chunks: chunks.length },
        },
      })
      logger.info({ contractId, dims: embedding.length, newChunks: 0 }, "[embed] embedded contract")
      await chainAiExtract()
      return
    }

    // Only swap rows once we know at least one chunk succeeded.
    await db.$transaction([
      db.$executeRaw`DELETE FROM "ContractChunkEmbedding" WHERE "contractId" = ${contractId}`,
      ...collected.map(
        (c) => db.$executeRaw`
          INSERT INTO "ContractChunkEmbedding" ("id", "contractId", "chunkIndex", "text", "embedding", "model", "createdAt", "updatedAt")
          VALUES (${crypto.randomUUID()}, ${contractId}, ${c.index}, ${c.text}, ${JSON.stringify(c.embedding)}::vector, ${model}, NOW(), NOW())
        `,
      ),
    ])

    if (failures > 0) {
      logger.warn({ contractId, failures, totalChunks: chunks.length }, "[embed] some chunks failed")
    }

    logger.info(
      { contractId, dims: embedding.length, succeededChunks: collected.length, totalChunks: chunks.length },
      "[embed] embedded contract",
    )

    await chainAiExtract()
  },
  { connection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } } },
)

embedWorker.on("completed", (job) =>
  logger.info({ jobId: job.id }, "[embed] job completed"),
)
embedWorker.on("failed", (job, err) =>
  logger.error({ err, jobId: job?.id }, "[embed] job failed"),
)

// ─── Worker: alerts.check ─────────────────────────────────────────────────────

const alertsWorker = new Worker<AlertsCheckJobData>(
  "alerts.check",
  async (job: Job<AlertsCheckJobData>) => {
    logger.info({ jobId: job.id, triggeredAt: job.data.triggeredAt }, "[alerts] running check job")
    const { fired, errors } = await checkAndFireAlerts()
    logger.info({ fired, errors }, "[alerts] check job complete")
  },
  { connection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } } },
)

alertsWorker.on("completed", (job) =>
  logger.info({ jobId: job.id }, "[alerts] job completed"),
)
alertsWorker.on("failed", (job, err) =>
  logger.error({ err, jobId: job?.id }, "[alerts] job failed"),
)

// ─── Worker: obligations.check ────────────────────────────────────────────────

const obligationsWorker = new Worker<ObligationsCheckJobData>(
  "obligations.check",
  async (job: Job<ObligationsCheckJobData>) => {
    logger.info({ jobId: job.id, triggeredAt: job.data.triggeredAt }, "[obligations] running check job")

    const db = getWorkerPrisma()
    const now = new Date()

    // Step 1 — promote past-due active obligations to OVERDUE.
    // The updateMany + activity writes are wrapped in a single transaction so
    // that a worker crash between the two cannot leave obligations stuck in
    // OVERDUE with no audit trail. Notifications are enqueued AFTER the
    // transaction commits — BullMQ and Prisma are separate systems; if the
    // enqueue fails, the obligation is already OVERDUE with an activity row.
    // The next cron run uses updatedAt windowing to re-enqueue, so no
    // notification is permanently lost.
    const runStart = new Date(now.getTime() - 60_000)

    type OverdueObligation = {
      id: string
      contractId: string
      title: string
      dueDate: Date
      assignee: { id: string; name: string | null } | null
    }

    let updateCount = 0
    let nowOverdue: OverdueObligation[] = []

    await db.$transaction(async (tx) => {
      const updateRes = await tx.contractObligation.updateMany({
        where: {
          status: { in: ["PENDING", "IN_PROGRESS"] },
          dueDate: { lt: now },
        },
        data: { status: "OVERDUE" },
      })
      updateCount = updateRes.count

      if (updateRes.count === 0) return

      nowOverdue = await tx.contractObligation.findMany({
        where: {
          status: "OVERDUE",
          updatedAt: { gte: runStart },
        },
        select: {
          id: true,
          contractId: true,
          title: true,
          dueDate: true,
          assignee: { select: { id: true, name: true } },
        },
      })

      // Write activity rows inside the transaction — they roll back with the
      // status update if anything fails, keeping audit trail consistent.
      if (nowOverdue.length > 0) {
        await tx.activity.createMany({
          data: nowOverdue.map((ob) => ({
            contractId: ob.contractId,
            userId: null,
            actorLabel: "System",
            action: "OBLIGATION_UPDATED",
            detail: `Obligation auto-marked OVERDUE: ${ob.title}`,
            metadata: { obligationId: ob.id },
          })),
        })
      }
    })

    // Enqueue notifications outside the transaction — BullMQ cannot participate
    // in a Prisma transaction. If this fails, the obligation is already OVERDUE
    // with an activity record; the next cron run re-notifies via updatedAt guard.
    let overdueNotified = 0
    for (const ob of nowOverdue) {
      await enqueueNotification("obligation.overdue", ob.contractId, null, {
        obligationId: ob.id,
        obligationTitle: ob.title,
        dueDate: ob.dueDate.toISOString(),
        assigneeName: ob.assignee?.name ?? null,
        daysUntilDue: 0,
      })
      overdueNotified += 1
    }

    // Step 2 — send reminders. reminderDays varies per obligation, so we filter
    // in app code rather than in the SQL where clause.
    const reminderCandidates = await db.contractObligation.findMany({
      where: {
        status: { in: ["PENDING", "IN_PROGRESS"] },
        reminderSentAt: null,
      },
      select: {
        id: true,
        contractId: true,
        title: true,
        dueDate: true,
        reminderDays: true,
        assignee: { select: { id: true, name: true } },
      },
    })

    const eligible = reminderCandidates.filter((o) => {
      const triggerAt = new Date(o.dueDate.getTime() - o.reminderDays * 86_400_000)
      return triggerAt <= now
    })

    let remindersSent = 0
    for (const ob of eligible) {
      // Atomic guard so a concurrent run can't double-send. updateMany with the
      // null filter returns count=0 if reminderSentAt was already set, which we
      // use as the "skip — already sent" signal.
      const guard = await db.contractObligation.updateMany({
        where: { id: ob.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      })
      if (guard.count === 0) continue

      await enqueueNotification("obligation.due_soon", ob.contractId, null, {
        obligationId: ob.id,
        obligationTitle: ob.title,
        dueDate: ob.dueDate.toISOString(),
        assigneeName: ob.assignee?.name ?? null,
        daysUntilDue: ob.reminderDays,
      })
      remindersSent += 1
    }

    logger.info(
      { updateCount, overdueNotified, remindersSent },
      "[obligations] check job complete",
    )
  },
  { connection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } } },
)

obligationsWorker.on("completed", (job) =>
  logger.info({ jobId: job.id }, "[obligations] job completed"),
)
obligationsWorker.on("failed", (job, err) =>
  logger.error({ err, jobId: job?.id }, "[obligations] job failed"),
)

// ─── Worker: obligations.ai_extract ──────────────────────────────────────────

const OBLIGATION_EXTRACTION_PROMPT = `You are a contract analysis assistant. Identify all obligations, commitments, deliverables, and deadlines in this contract.

Return ONLY a valid JSON array. Each item must have this exact shape:
{
  "title": <short obligation title, max 100 chars>,
  "description": <1-2 sentence description of the obligation>,
  "clauseReference": <clause/section reference e.g. "Section 4.2" or null>,
  "priority": <"HIGH" | "MEDIUM" | "LOW" — HIGH for payment/penalty/termination obligations>,
  "suggestedDueDays": <number of days from today to suggest as due date, integer 1-365, use 30 if unclear>,
  "confidence": <number between 0 and 1 — how confident you are this is a genuine contractual obligation: 1.0 = explicit obligation with clear deadline, 0.5 = inferred commitment, 0.2 = vague or general statement>
}

Return ONLY the JSON array. No explanation, no markdown fences. Max 20 obligations.`

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
      temperature: 0, // obligation extraction — deterministic, factual output
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
      temperature: 0, // obligation extraction — deterministic, factual output
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

const obligationExtractWorker = new Worker<ObligationExtractJobData>(
  "obligations.ai_extract",
  async (job: Job<ObligationExtractJobData>) => {
    const { contractId, extractedText } = job.data
    logger.info({ jobId: job.id, contractId }, "[obligations.extract] processing job")

    const raw = await callObligationLLM(extractedText)
    if (!raw) throw new Error("no_ai_provider")

    let suggestions: unknown
    try {
      suggestions = JSON.parse(raw)
    } catch {
      throw new Error("parse_error: " + raw.slice(0, 200))
    }

    // Return value is stored by BullMQ in Redis and available via job.returnvalue
    return suggestions
  },
  { connection, defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200, attempts: 1 } },
)

obligationExtractWorker.on("completed", (job) =>
  logger.info({ jobId: job.id }, "[obligations.extract] job completed"),
)
obligationExtractWorker.on("failed", (job, err) =>
  logger.error({ err, jobId: job?.id }, "[obligations.extract] job failed"),
)

// ─── Worker: signing.sync ─────────────────────────────────────────────────────
// Handler extracted to worker/jobs/signing-sync.ts per CLAUDE.md convention.
// "Job handlers live in worker/ — not in apps/web/"

const signingWorker = createSigningSyncWorker(connection)

// ─── Worker: email.send ───────────────────────────────────────────────────────

const emailWorker = new Worker<EmailJobData>(
  "email.send",
  async (job: Job<EmailJobData>) => {
    const data = job.data
    try {
      if (data.kind === "alert") {
        await sendAlertEmailById(data.alertId)
        return
      }
      if (data.kind === "approval_request") {
        await sendApprovalRequestEmail({
          to: data.to,
          assigneeName: data.assigneeName,
          requesterName: data.requesterName,
          contractTitle: data.contractTitle,
          message: data.message,
        })
        return
      }
      if (data.kind === "approval_rejected") {
        await sendApprovalRejectionEmail({
          to: data.to,
          requesterName: data.requesterName,
          reviewerName: data.reviewerName,
          contractTitle: data.contractTitle,
          comment: data.comment,
        })
        return
      }
      if (data.kind === "event_notification") {
        // orgName is looked up here so the event_notification job stays small
        // (the fanout job already loaded the full contract context).
        const contract = await getWorkerPrisma().contract.findUnique({
          where: { id: data.contractId },
          select: { organization: { select: { name: true } } },
        })
        await sendEventNotificationEmail({
          to: data.to,
          eventName: data.eventName,
          contractId: data.contractId,
          contractTitle: data.contractTitle,
          actorName: data.actorName,
          orgName: contract?.organization.name ?? "your organization",
          metadata: data.metadata,
          unsubscribeToken: data.unsubscribeToken,
        })
        return
      }
    } catch (err: unknown) {
      // attempts: 1 — failed jobs land in BullMQ's failed queue rather than
      // retrying. SMTP sends are not idempotent, so a retry of a partially-
      // succeeded send would duplicate the email.
      logger.error({ err, jobId: job.id, kind: data.kind }, "[email.send] failed")
      throw err
    }
  },
  { connection, defaultJobOptions: { attempts: 1 } },
)

emailWorker.on("completed", (job) =>
  logger.info({ jobId: job.id }, "[email] job completed"),
)
emailWorker.on("failed", (job, err) =>
  logger.error({ err, jobId: job?.id }, "[email] job failed"),
)

// ─── Worker: notification.fanout ──────────────────────────────────────────────

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:3000"
  )
}

// Use shared helper so token format stays in lockstep with verifyUnsubscribeToken()
const unsubscribeToken = buildUnsubscribeToken

const fanoutWorker = new Worker<NotificationFanoutJobData>(
  "notification.fanout",
  async (job: Job<NotificationFanoutJobData>) => {
    const { eventName, contractId, actorId, metadata } = job.data
    logger.info({ eventName, contractId, actorId: actorId ?? "system" }, "[fanout] processing event")

    const db = getWorkerPrisma()

    // 1. Resolve contract + org context
    const contract = await db.contract.findUnique({
      where: { id: contractId },
      select: {
        id: true,
        title: true,
        status: true,
        ownerId: true,
        counterpartyName: true,
        organizationId: true,
        organization: { select: { id: true, name: true } },
      },
    })
    if (!contract) {
      logger.warn({ contractId }, "[fanout] contract not found — skipping")
      return
    }

    const actor = actorId
      ? await db.user.findUnique({
          where: { id: actorId },
          select: { id: true, name: true, email: true },
        })
      : null

    // 2. Build the standard webhook envelope (used for outbound webhook delivery)
    const envelope = {
      event: eventName,
      orgId: contract.organizationId,
      timestamp: new Date().toISOString(),
      apiVersion: WEBHOOK_API_VERSION,
      data: {
        contractId: contract.id,
        contractTitle: contract.title,
        counterpartyName: contract.counterpartyName,
        status: contract.status,
        ownerId: contract.ownerId,
        actorId: actor?.id ?? null,
        actorName: actor?.name ?? null,
        metadata,
      },
    }

    // 3. Slack/Teams channels (DB-configured)
    const channels = await db.orgNotificationChannel.findMany({
      where: { organizationId: contract.organizationId, enabled: true },
      select: { id: true },
    })
    for (const ch of channels) {
      await notificationDeliverQueue.add("deliver", {
        kind: "slack", // overwritten below if teams; lookup happens in deliver worker via channelId
        channelId: ch.id,
        eventName,
        contractId: contract.id,
        contractTitle: contract.title,
        counterpartyName: contract.counterpartyName,
        actorName: actor?.name ?? null,
        appUrl: appUrl(),
        metadata,
      } as NotificationDeliverJobData)
    }

    // 4. Outbound webhooks — pre-create delivery log row, pre-compute HMAC, enqueue
    const webhooks = await db.outboundWebhook.findMany({
      where: { organizationId: contract.organizationId, enabled: true },
      select: { id: true, signingSecret: true },
    })
    for (const wh of webhooks) {
      const payload = JSON.stringify(envelope)
      let signature: string
      try {
        const secretHex = decrypt(wh.signingSecret)
        const secretBytes = Buffer.from(secretHex, "hex")
        signature =
          "sha256=" +
          crypto.createHmac("sha256", secretBytes).update(payload).digest("hex")
      } catch (err) {
        logger.error({ err, webhookId: wh.id }, "[fanout] failed to decrypt signingSecret — skipping webhook")
        continue
      }

      const log = await db.webhookDeliveryLog.create({
        data: {
          webhookId: wh.id,
          eventName,
          contractId: contract.id,
          payload: envelope as object,
          attempt: 1,
          status: "pending",
        },
        select: { id: true },
      })

      await notificationDeliverQueue.add("deliver", {
        kind: "webhook",
        webhookId: wh.id,
        deliveryLogId: log.id,
        attempt: 1,
        payload,
        signature,
      })
    }

    // 5. Email recipients filtered by user preference
    const recipientIds = await resolveEmailRecipientIds(
      eventName as NotificationEventName,
      contract.id,
      contract.ownerId,
      contract.organizationId,
      actor?.id ?? null,
      metadata,
    )
    if (recipientIds.size > 0) {
      const users = await db.user.findMany({
        where: { id: { in: Array.from(recipientIds) } },
        select: { id: true, email: true },
      })
      const prefs = await db.userNotificationPreference.findMany({
        where: {
          userId: { in: users.map((u) => u.id) },
          organizationId: contract.organizationId,
          eventName,
        },
        select: { userId: true, emailEnabled: true },
      })
      const prefByUser = new Map(prefs.map((p) => [p.userId, p.emailEnabled]))
      const defaultEnabled = DEFAULT_EMAIL_ENABLED[eventName as NotificationEventName] ?? false

      for (const u of users) {
        const enabled = prefByUser.has(u.id) ? prefByUser.get(u.id)! : defaultEnabled
        if (!enabled) continue
        const token = unsubscribeToken(u.id, contract.organizationId, eventName)
        await emailQueue.add("send", {
          kind: "event_notification",
          eventName,
          to: u.email,
          contractId: contract.id,
          contractTitle: contract.title,
          actorName: actor?.name ?? null,
          metadata,
          unsubscribeToken: token,
        })
      }
    }

    // 6. In-app notifications — only for cron-triggered events (expiring_soon,
    // expired, obligation.due_soon, obligation.overdue). Route-triggered events
    // (approval.*, contract.uploaded, archived, sent_for_signing, signed,
    // signing_declined) write in-app rows directly from the API route so they
    // are guaranteed regardless of whether the worker is running.
    const CRON_IN_APP_EVENTS = new Set<string>([
      "contract.expiring_soon",
      "contract.expired",
      "obligation.due_soon",
      "obligation.overdue",
    ])
    if (CRON_IN_APP_EVENTS.has(eventName)) {
      await createInAppNotifications(
        db,
        eventName as NotificationEventName,
        contract.id,
        contract.title,
        contract.organizationId,
        actor,
        metadata,
      )
    }
  },
  // attempts: 1 — fanout enqueues per-channel deliver jobs that have their own
  // retry logic. Retrying the fanout itself would re-deliver to channels that
  // already succeeded on the previous attempt.
  { connection, defaultJobOptions: { attempts: 1 } },
)

fanoutWorker.on("completed", (job) =>
  logger.info({ jobId: job.id }, "[fanout] job completed"),
)
fanoutWorker.on("failed", (job, err) =>
  logger.error({ err, jobId: job?.id }, "[fanout] job failed"),
)

// ─── In-app notification helper ───────────────────────────────────────────────
// Creates Notification rows for per-event target users. Each write is fire-and-
// forget (.catch logged) so a DB failure never blocks the outer fanout job.

async function createInAppNotifications(
  db: ReturnType<typeof getWorkerPrisma>,
  eventName: NotificationEventName,
  contractId: string,
  contractTitle: string,
  organizationId: string,
  actor: { id: string; name: string; email: string } | null,
  metadata: Record<string, string | number | boolean | null>,
): Promise<void> {
  const actorName = actor?.name ?? "Someone"

  async function writeNotification(
    userId: string,
    title: string,
    body: string,
  ): Promise<void> {
    await db.notification.create({
      data: {
        userId,
        organizationId,
        contractId,
        eventName,
        title,
        body,
      },
    }).catch((err) => logger.error({ err }, "[fanout] in-app notification write failed"))
  }

  switch (eventName) {
    case "approval.requested": {
      const assigneeId = typeof metadata.assigneeId === "string" ? metadata.assigneeId : null
      const requesterName = typeof metadata.requesterName === "string" ? metadata.requesterName : actorName
      if (assigneeId) {
        await writeNotification(
          assigneeId,
          "Approval requested",
          `${requesterName} asked you to approve "${contractTitle}"`,
        )
      }
      break
    }

    case "approval.approved":
    case "approval.rejected": {
      const approvalId = typeof metadata.approvalId === "string" ? metadata.approvalId : null
      const decidedByName = typeof metadata.decidedByName === "string" ? metadata.decidedByName : actorName
      const verb = eventName === "approval.approved" ? "approved" : "rejected"
      if (approvalId) {
        const approval = await db.approval.findUnique({
          where: { id: approvalId },
          select: { requestedById: true },
        }).catch(() => null)
        if (approval?.requestedById) {
          await writeNotification(
            approval.requestedById,
            eventName === "approval.approved" ? "Approval approved" : "Approval rejected",
            `${decidedByName} ${verb} "${contractTitle}"`,
          )
        }
      }
      break
    }

    case "contract.sent_for_signing": {
      // Notify all org members with role legal, admin, or owner
      const members = await db.member.findMany({
        where: { organizationId, role: { in: ["legal", "admin", "owner"] } },
        select: { userId: true },
      }).catch(() => [] as Array<{ userId: string }>)
      for (const m of members) {
        await writeNotification(
          m.userId,
          "Ready for signing",
          `"${contractTitle}" is ready for signing`,
        )
      }
      break
    }

    case "contract.uploaded": {
      const members = await db.member.findMany({
        where: { organizationId, role: { in: ["legal", "admin", "owner"] } },
        select: { userId: true },
      }).catch(() => [] as Array<{ userId: string }>)
      for (const m of members) {
        if (m.userId === actor?.id) continue
        await writeNotification(
          m.userId,
          "Contract file uploaded",
          `${actorName} uploaded a file to "${contractTitle}"`,
        )
      }
      break
    }

    case "contract.archived": {
      const members = await db.member.findMany({
        where: { organizationId, role: { in: ["legal", "admin", "owner"] } },
        select: { userId: true },
      }).catch(() => [] as Array<{ userId: string }>)
      for (const m of members) {
        if (m.userId === actor?.id) continue
        await writeNotification(
          m.userId,
          "Contract archived",
          `${actorName} archived "${contractTitle}"`,
        )
      }
      break
    }

    case "contract.signed": {
      const members = await db.member.findMany({
        where: { organizationId, role: { in: ["legal", "admin", "owner"] } },
        select: { userId: true },
      }).catch(() => [] as Array<{ userId: string }>)
      for (const m of members) {
        await writeNotification(
          m.userId,
          "Contract signed",
          `"${contractTitle}" has been fully signed`,
        )
      }
      break
    }

    case "contract.signing_declined": {
      const status = typeof metadata.signingStatus === "string" ? metadata.signingStatus : "declined"
      const members = await db.member.findMany({
        where: { organizationId, role: { in: ["legal", "admin", "owner"] } },
        select: { userId: true },
      }).catch(() => [] as Array<{ userId: string }>)
      for (const m of members) {
        await writeNotification(
          m.userId,
          "Signing " + status,
          `"${contractTitle}" signing was ${status} by the counterparty`,
        )
      }
      break
    }

    case "contract.expiring_soon": {
      const daysLeft = typeof metadata.daysUntilExpiry === "number" ? metadata.daysUntilExpiry : null
      const members = await db.member.findMany({
        where: { organizationId, role: { in: ["legal", "admin", "owner"] } },
        select: { userId: true },
      }).catch(() => [] as Array<{ userId: string }>)
      for (const m of members) {
        await writeNotification(
          m.userId,
          "Contract expiring soon",
          daysLeft != null
            ? `"${contractTitle}" expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`
            : `"${contractTitle}" is expiring soon`,
        )
      }
      break
    }

    case "contract.expired": {
      const members = await db.member.findMany({
        where: { organizationId, role: { in: ["legal", "admin", "owner"] } },
        select: { userId: true },
      }).catch(() => [] as Array<{ userId: string }>)
      for (const m of members) {
        await writeNotification(
          m.userId,
          "Contract expired",
          `"${contractTitle}" has expired`,
        )
      }
      break
    }

    case "obligation.due_soon":
    case "obligation.overdue": {
      const obligationTitle = typeof metadata.obligationTitle === "string" ? metadata.obligationTitle : "An obligation"
      const daysUntilDue = typeof metadata.daysUntilDue === "number" ? metadata.daysUntilDue : null
      const title = eventName === "obligation.overdue" ? "Obligation overdue" : "Obligation due soon"
      const body = eventName === "obligation.overdue"
        ? `"${obligationTitle}" on "${contractTitle}" is overdue`
        : daysUntilDue != null && daysUntilDue > 0
          ? `"${obligationTitle}" on "${contractTitle}" is due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`
          : `"${obligationTitle}" on "${contractTitle}" is due soon`

      const members = await db.member.findMany({
        where: { organizationId, role: { in: ["legal", "admin", "owner"] } },
        select: { userId: true },
      }).catch(() => [] as Array<{ userId: string }>)
      for (const m of members) {
        await writeNotification(m.userId, title, body)
      }

      // Also notify the obligation assignee if set and not already notified
      const obligationId = typeof metadata.obligationId === "string" ? metadata.obligationId : null
      if (obligationId) {
        const ob = await db.contractObligation.findUnique({
          where: { id: obligationId },
          select: { assigneeId: true },
        }).catch(() => null)
        const assigneeId = ob?.assigneeId ?? null
        if (assigneeId) {
          const alreadyNotified = members.some(m => m.userId === assigneeId)
          if (!alreadyNotified) {
            await writeNotification(assigneeId, title, body)
          }
        }
      }
      break
    }

    default:
      // No in-app notification for other events (they get email/Slack/webhook)
      break
  }
}

// Resolve per-event default recipients. Returns the set of userIds whose
// preferences should be checked. The caller filters by UserNotificationPreference
// (defaulting to DEFAULT_EMAIL_ENABLED when no row exists).
async function resolveEmailRecipientIds(
  eventName: NotificationEventName,
  contractId: string,
  ownerId: string,
  orgId: string,
  actorId: string | null,
  metadata: Record<string, string | number | boolean | null>,
): Promise<Set<string>> {
  const db = getWorkerPrisma()
  const ids = new Set<string>()

  switch (eventName) {
    case "contract.uploaded":
    case "contract.extracted":
    case "contract.sent_for_signing":
    case "contract.signed":
    case "contract.archived":
      ids.add(ownerId)
      break

    case "contract.signing_declined":
      ids.add(ownerId)
      break

    case "approval.requested": {
      const assigneeId = typeof metadata.assigneeId === "string" ? metadata.assigneeId : null
      if (assigneeId) ids.add(assigneeId)
      break
    }

    case "approval.approved":
    case "approval.rejected": {
      const requesterId = typeof metadata.requesterId === "string" ? metadata.requesterId : null
      if (requesterId) ids.add(requesterId)
      ids.add(ownerId)
      break
    }

    case "contract.expiring_soon":
    case "contract.expired": {
      ids.add(ownerId)
      const admins = await db.member.findMany({
        where: { organizationId: orgId, role: "admin" },
        select: { userId: true },
      })
      for (const a of admins) ids.add(a.userId)
      break
    }

    case "obligation.due_soon":
    case "obligation.overdue": {
      // Notify the contract owner and the obligation's assignee (if set).
      // metadata.obligationId lets us look up the assignee even when the
      // assigneeName is the only field included in the payload.
      ids.add(ownerId)
      const obligationId = typeof metadata.obligationId === "string" ? metadata.obligationId : null
      if (obligationId) {
        const ob = await db.contractObligation.findUnique({
          where: { id: obligationId },
          select: { assigneeId: true },
        })
        if (ob?.assigneeId) ids.add(ob.assigneeId)
      }
      break
    }

    case "import.completed": {
      // Import is org-scoped (no single contract owner is meaningful). Notify
      // org admins so the team that triggered the migration sees the result.
      const admins = await db.member.findMany({
        where: { organizationId: orgId, role: "admin" },
        select: { userId: true },
      })
      for (const a of admins) ids.add(a.userId)
      break
    }
  }

  // Don't email the actor about their own action.
  if (actorId) ids.delete(actorId)
  return ids
}

// ─── Worker: notification.deliver ─────────────────────────────────────────────

const RETRY_DELAYS_MS = [10_000, 30_000] // attempt 1 → 2 uses index 0; 2 → 3 uses index 1

const deliverWorker = new Worker<NotificationDeliverJobData>(
  "notification.deliver",
  async (job: Job<NotificationDeliverJobData>) => {
    const data = job.data

    if (data.kind === "slack" || data.kind === "teams") {
      // Channel kind is determined by the DB record, not the job's kind hint
      // (fanout enqueues every channel without lookup).
      const channel = await getWorkerPrisma().orgNotificationChannel.findUnique({
        where: { id: data.channelId },
        select: { channelType: true, webhookUrl: true, enabled: true },
      })
      if (!channel || !channel.enabled) {
        logger.warn({ channelId: data.channelId }, "[deliver] channel missing or disabled")
        return
      }

      let plaintextUrl: string
      try {
        plaintextUrl = decrypt(channel.webhookUrl)
      } catch (err) {
        logger.error({ err, channelId: data.channelId }, "[deliver] failed to decrypt webhookUrl")
        return
      }

      const opts = {
        webhookUrl: plaintextUrl,
        eventName: data.eventName,
        contractTitle: data.contractTitle,
        counterpartyName: data.counterpartyName,
        actorName: data.actorName,
        contractId: data.contractId,
        appUrl: data.appUrl,
        metadata: data.metadata,
      }

      if (channel.channelType === "slack") {
        await sendSlackEvent(opts)
      } else if (channel.channelType === "teams") {
        await sendTeamsEvent(opts)
      } else {
        logger.warn({ channelType: channel.channelType, channelId: data.channelId }, "[deliver] unknown channelType")
      }
      return
    }

    if (data.kind === "webhook") {
      const db = getWorkerPrisma()
      const webhook = await db.outboundWebhook.findUnique({
        where: { id: data.webhookId },
        select: { url: true, enabled: true },
      })
      if (!webhook || !webhook.enabled) {
        logger.warn({ webhookId: data.webhookId }, "[deliver] webhook missing or disabled")
        await db.webhookDeliveryLog.update({
          where: { id: data.deliveryLogId },
          data: { status: "failed", responseBody: "webhook disabled or deleted" },
        })
        return
      }

      let plaintextUrl: string
      try {
        plaintextUrl = decrypt(webhook.url)
      } catch (err) {
        logger.error({ err, webhookId: data.webhookId }, "[deliver] failed to decrypt webhook URL")
        await db.webhookDeliveryLog.update({
          where: { id: data.deliveryLogId },
          data: { status: "failed", responseBody: "decryption failed" },
        })
        return
      }

      const start = Date.now()
      let httpStatus: number | null = null
      let bodyText: string | null = null
      let success = false

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      try {
        const res = await fetch(plaintextUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-ClauseFlow-Signature": data.signature,
          },
          body: data.payload,
          signal: controller.signal,
        })
        httpStatus = res.status
        try {
          const text = await res.text()
          bodyText = text.slice(0, 1000)
        } catch {
          bodyText = null
        }
        success = res.ok
      } catch (err) {
        logger.error({ err, webhookId: data.webhookId, attempt: data.attempt }, "[deliver] webhook fetch failed")
      } finally {
        clearTimeout(timer)
      }

      const durationMs = Date.now() - start

      if (success) {
        await db.webhookDeliveryLog.update({
          where: { id: data.deliveryLogId },
          data: {
            status: "success",
            httpStatus,
            responseBody: bodyText,
            durationMs,
            deliveredAt: new Date(),
          },
        })
        return
      }

      await db.webhookDeliveryLog.update({
        where: { id: data.deliveryLogId },
        data: {
          status: "failed",
          httpStatus,
          responseBody: bodyText,
          durationMs,
        },
      })

      if (data.attempt < 3) {
        const nextAttempt = data.attempt + 1
        const delay = RETRY_DELAYS_MS[data.attempt - 1] ?? 30_000

        // Each retry is a fresh delivery log row so the per-attempt history is
        // visible end-to-end. Fetch both fields in one query to avoid race
        // conditions if the original log is deleted between reads.
        const originalLog = await db.webhookDeliveryLog.findUnique({
          where: { id: data.deliveryLogId },
          select: { eventName: true, contractId: true },
        })
        const nextLog = await db.webhookDeliveryLog.create({
          data: {
            webhookId: data.webhookId,
            eventName: originalLog?.eventName ?? "unknown",
            contractId: originalLog?.contractId ?? "unknown",
            payload: JSON.parse(data.payload) as object,
            attempt: nextAttempt,
            status: "pending",
          },
          select: { id: true },
        })

        await notificationDeliverQueue.add(
          "deliver",
          {
            kind: "webhook",
            webhookId: data.webhookId,
            deliveryLogId: nextLog.id,
            attempt: nextAttempt,
            payload: data.payload,
            signature: data.signature,
          },
          { delay },
        )
      }
      return
    }
  },
  { connection, defaultJobOptions: { attempts: 1 } }, // retries are managed inline, never by BullMQ
)

deliverWorker.on("completed", (job) =>
  logger.info({ jobId: job.id }, "[deliver] job completed"),
)
deliverWorker.on("failed", (job, err) =>
  logger.error({ err, jobId: job?.id }, "[deliver] job failed"),
)

// ─── Worker: document.convert (M6 — Word import → Plate JSON) ─────────────────

const documentConvertWorker = new Worker<DocumentConvertJobData>(
  "document.convert",
  async (job: Job<DocumentConvertJobData>) => {
    const { contractId, storageKey, requestedById, fileType = "docx" } = job.data
    logger.info({ jobId: job.id, contractId, fileType }, "[document.convert] processing job")

    const db = getWorkerPrisma()

    let buffer: Buffer
    try {
      const signedUrl = await storage.getSignedDownloadUrl(storageKey)
      const res = await fetch(signedUrl)
      if (!res.ok) throw new Error(`Failed to download file from storage: ${res.status}`)
      buffer = Buffer.from(await res.arrayBuffer())
    } catch (err) {
      logger.error({ err, contractId, storageKey }, "[document.convert] download failed")
      await storage.delete(storageKey).catch(() => {})
      throw err
    }

    let nodes: ReturnType<typeof htmlToPlateNodes>

    if (fileType === "pdf") {
      // Try LibreOffice PDF→DOCX first — preserves tables, headings, and structure.
      // Falls back to plain-text extraction when LibreOffice is unavailable or fails.
      const docxBuffer = await pdfToDocxBuffer(buffer)
      if (docxBuffer) {
        let html: string
        try {
          const result = await mammoth.convertToHtml({ buffer: docxBuffer })
          html = result.value ?? ""
          logger.debug({ contractId, htmlChars: html.length }, "[document.convert] PDF→DOCX via LibreOffice, mammoth HTML")
        } catch (err) {
          logger.error({ err, contractId }, "[document.convert] mammoth failed on LibreOffice DOCX")
          await storage.delete(storageKey).catch(() => {})
          throw err
        }
        nodes = htmlToPlateNodes(html)
      } else {
        // LibreOffice unavailable or failed — fall back to plain text.
        let rawText: string
        try {
          const result = await pdfParse(buffer)
          rawText = result.text ?? ""
          logger.debug({ contractId, rawChars: rawText.length }, "[document.convert] PDF text extracted (fallback)")
        } catch (err) {
          logger.error({ err, contractId }, "[document.convert] pdf-parse failed")
          await storage.delete(storageKey).catch(() => {})
          throw err
        }
        nodes = plaintextToPlateNodes(rawText)
      }
    } else {
      // DOCX: mammoth → HTML → Plate AST (formatting preserved)
      let html: string
      try {
        const result = await mammoth.convertToHtml({ buffer })
        html = result.value ?? ""
      } catch (err) {
        logger.error({ err, contractId }, "[document.convert] mammoth failed for DOCX")
        await storage.delete(storageKey).catch(() => {})
        throw err
      }
      nodes = htmlToPlateNodes(html)
    }

    const plaintext = plateToPlaintext(nodes)
    const wordCount = countWords(plaintext)

    const existing = await db.contractDocument.findUnique({
      where: { contractId },
      select: { id: true, version: true },
    })

    if (existing) {
      await db.contractDocument.update({
        where: { contractId },
        data: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content: nodes as any,
          wordCount,
          version: existing.version + 1,
          savedById: requestedById,
        },
      })
    } else {
      await db.contractDocument.create({
        data: {
          contractId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content: nodes as any,
          wordCount,
          version: 1,
          savedById: requestedById,
        },
      })
    }

    await storage.delete(storageKey).catch((err) =>
      logger.warn({ err, storageKey }, "[document.convert] failed to delete tmp object"),
    )

    const sourceLabel = fileType === "pdf" ? "PDF" : "Word document"
    await db.activity.create({
      data: {
        contractId,
        userId: requestedById,
        action: "DOCUMENT_IMPORTED",
        detail: `Imported ${sourceLabel} (${wordCount} words)`,
      },
    })

    logger.info({ contractId, wordCount, fileType }, "[document.convert] imported document")
  },
  { connection, defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200, attempts: 1 } },
)

documentConvertWorker.on("completed", (job) =>
  logger.info({ jobId: job.id }, "[document.convert] job completed"),
)
documentConvertWorker.on("failed", (job, err) =>
  logger.error({ err, jobId: job?.id }, "[document.convert] job failed"),
)

// ─── Worker: salesforce.poll (M9 — periodic CRM sync) ────────────────────────

const salesforcePollWorker = new Worker<SalesforcePollJobData>(
  "salesforce.poll",
  async (job: Job<SalesforcePollJobData>) => {
    logger.info({ jobId: job.id, triggeredAt: job.data.triggeredAt }, "[salesforce.poll] processing job")

    const db = getWorkerPrisma()
    const integrations = await db.crmIntegration.findMany({
      where: { provider: "SALESFORCE" },
    })
    if (integrations.length === 0) {
      logger.info("[salesforce.poll] no Salesforce integrations connected")
      return
    }

    const sf = getCrmProvider("SALESFORCE")

    for (const integration of integrations) {
      // Refresh tokens up front so a single expiring access token doesn't
      // cascade into N failed getDeal calls below.
      let active = integration
      const expiresAt = integration.tokenExpiresAt
      if (expiresAt && expiresAt.getTime() - Date.now() < 60_000 && integration.refreshToken) {
        try {
          const fresh = await sf.refreshAccessToken(integration)
          active = await db.crmIntegration.update({
            where: { id: integration.id },
            data: {
              accessToken: encryptToken(fresh.accessToken),
              refreshToken: fresh.refreshToken
                ? encryptToken(fresh.refreshToken)
                : integration.refreshToken,
              tokenExpiresAt: fresh.expiresAt ?? integration.tokenExpiresAt,
              instanceUrl: fresh.instanceUrl ?? integration.instanceUrl,
            },
          })
        } catch (err) {
          logger.error(
            { err, integrationId: integration.id },
            "[salesforce.poll] Refresh failed for integration",
          )
          continue
        }
      }

      const links = await db.crmLink.findMany({
        where: { integrationId: active.id, provider: "SALESFORCE" },
        select: {
          id: true,
          contractId: true,
          externalDealId: true,
          contract: { select: { id: true, status: true } },
        },
      })

      for (const link of links) {
        let deal
        try {
          deal = await sf.getDeal(active, link.externalDealId)
        } catch (err) {
          logger.error(
            { err, linkId: link.id },
            "[salesforce.poll] getDeal failed for link",
          )
          await db.crmLink.update({
            where: { id: link.id },
            data: { lastSyncedAt: new Date(), lastSyncStatus: "fetch_failed" },
          })
          continue
        }

        if (!deal) {
          await db.crmLink.update({
            where: { id: link.id },
            data: { lastSyncedAt: new Date(), lastSyncStatus: "deal_not_found" },
          })
          continue
        }

        await db.crmLink.update({
          where: { id: link.id },
          data: {
            lastSyncedAt: new Date(),
            lastSyncStatus: "success",
            externalDealName: deal.name,
            externalDealUrl: deal.url,
          },
        })

        const targetStage = active.syncOnActiveStage
        if (
          targetStage &&
          deal.stage &&
          deal.stage.toLowerCase() === targetStage.toLowerCase()
        ) {
          // State-machine guard — only AWAITING_SIGNATURE may transition to
          // ACTIVE. Use update-with-where so a concurrent worker can't push
          // DRAFT/PENDING_APPROVAL contracts straight to ACTIVE.
          try {
            await db.contract.update({
              where: { id: link.contractId, status: "AWAITING_SIGNATURE" },
              data: { status: "ACTIVE" },
            })

            await db.activity.create({
              data: {
                contractId: link.contractId,
                userId: null,
                actorLabel: "System",
                action: "CRM_SYNCED",
                detail: `Status set to ACTIVE from Salesforce stage "${deal.stage}"`,
                metadata: { provider: "SALESFORCE", dealId: deal.id, newStage: deal.stage },
              },
            })
          } catch (err) {
            // P2025: contract was not in AWAITING_SIGNATURE — silently skip.
            if ((err as { code?: string }).code !== "P2025") {
              throw err
            }
          }
        }
      }
    }

    logger.info(
      { count: integrations.length },
      "[salesforce.poll] Polled integrations",
    )
  },
  { connection, defaultJobOptions: { attempts: 1, removeOnComplete: 50, removeOnFail: 100 } },
)

salesforcePollWorker.on("completed", (job) =>
  logger.info({ jobId: job.id }, "[salesforce.poll] Job completed"),
)
salesforcePollWorker.on("failed", (job, err) =>
  logger.error({ jobId: job?.id, err }, "[salesforce.poll] Job failed"),
)

// ─── Worker: import.process (M10 — bulk contract import) ─────────────────────

const importWorker = new Worker<ImportProcessJobData>(
  "import.process",
  async (job: Job<ImportProcessJobData>) => {
    logger.info({ jobId: job.id, importJobId: job.data.importJobId }, "[import] Job started")
    await processImportJob(job.data)
  },
  { connection, concurrency: 2, defaultJobOptions: { attempts: 1, removeOnComplete: 200, removeOnFail: 500 } },
)

importWorker.on("completed", (job) =>
  logger.info({ jobId: job.id }, "[import] Job completed"),
)
importWorker.on("failed", (job, err) =>
  logger.error({ jobId: job?.id, err }, "[import] Job failed"),
)

// ─── Worker: document.export (M6 — Plate JSON → DOCX or PDF) ──────────────────

const documentExportWorker = new Worker<DocumentExportJobData>(
  "document.export",
  async (job: Job<DocumentExportJobData>) => {
    const { contractId, format, requestedById } = job.data
    logger.info({ jobId: job.id, contractId, format }, "[document.export] Job started")

    const db = getWorkerPrisma()
    const document = await db.contractDocument.findUnique({
      where: { contractId },
      select: { content: true },
    })
    if (!document) {
      throw new Error(`No document found for contract ${contractId}`)
    }

    let buffer: Buffer
    let contentType: string
    if (format === "docx") {
      buffer = await plateToDocxBuffer(document.content)
      contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    } else {
      buffer = await plateToPdfBuffer(document.content)
      contentType = "application/pdf"
    }

    const key = `exports/${contractId}/${job.id}.${format}`
    await storage.upload(key, buffer, contentType)
    const downloadUrl = await storage.getSignedDownloadUrl(key, 300)

    await db.activity.create({
      data: {
        contractId,
        userId: requestedById,
        action: "DOCUMENT_EXPORTED",
        detail: `Exported as ${format.toUpperCase()}`,
      },
    })

    logger.info({ contractId, format, bytes: buffer.length }, "[document.export] Export complete")
    return { downloadUrl }
  },
  { connection, defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200, attempts: 1 } },
)

documentExportWorker.on("completed", (job) =>
  logger.info({ jobId: job.id }, "[document.export] Job completed"),
)
documentExportWorker.on("failed", (job, err) =>
  logger.error({ jobId: job?.id, err }, "[document.export] Job failed"),
)

// Register the daily cron (9 AM UTC). BullMQ deduplicates by name + pattern,
// so restarting the worker is safe — no stacking of duplicate schedules.
alertsCheckQueue.add(
  "daily-check",
  { triggeredAt: new Date().toISOString() },
  { repeat: { pattern: "0 9 * * *" }, jobId: "alerts-daily" },
).then(() => logger.info("[alerts] Daily cron registered (0 9 * * *)"))
  .catch((err) => logger.error({ err }, "[alerts] Failed to register cron"))

// Webhooks are the primary path, but this periodic sync recovers missed or
// delayed DocuSeal callbacks.
signingSyncQueue.add(
  "poll-docuseal",
  { triggeredAt: new Date().toISOString() },
  { repeat: { pattern: "*/15 * * * *" } },
).then(() => logger.info("[signing] Sync cron registered (*/15 * * * *)"))
  .catch((err) => logger.error({ err }, "[signing] Failed to register sync cron"))

// Daily obligation sweep — auto-mark overdue + send reminders.
// jobId: "obligations-daily" prevents a second run from being enqueued while
// one is already in the queue, eliminating duplicate overdue notifications
// from concurrent cron fires within the same 60-second window.
obligationsCheckQueue.add(
  "daily-check",
  { triggeredAt: new Date().toISOString() },
  { repeat: { pattern: "0 9 * * *" }, jobId: "obligations-daily" },
).then(() => logger.info("[obligations] Daily cron registered (0 9 * * *)"))
  .catch((err) => logger.error({ err }, "[obligations] Failed to register cron"))

// Salesforce uses polling (no webhooks). Sweep linked deals every 15 minutes.
salesforcePollQueue.add(
  "poll-salesforce",
  { triggeredAt: new Date().toISOString() },
  { repeat: { pattern: "*/15 * * * *" } },
).then(() => logger.info("[salesforce.poll] Sync cron registered (*/15 * * * *)"))
  .catch((err) => logger.error({ err }, "[salesforce.poll] Failed to register cron"))

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// Collect all Worker instances so the shutdown handler can pause and drain them
// in one pass rather than calling close() on each individually.

const allWorkers: Worker[] = [
  extractWorker,
  aiExtractWorker,
  embedWorker,
  alertsWorker,
  obligationsWorker,
  signingWorker,
  emailWorker,
  fanoutWorker,
  deliverWorker,
  documentConvertWorker,
  documentExportWorker,
  salesforcePollWorker,
  importWorker,
  obligationExtractWorker,
]

async function gracefulShutdown(signal: string) {
  logger.info({ signal }, "[worker] Received signal, shutting down gracefully")

  // Stop workers from picking up new jobs while in-flight jobs finish.
  await Promise.all(allWorkers.map((w) => w.pause()))

  // Enforce a hard ceiling — if jobs haven't drained after 30 s, force exit.
  const drainTimeout = setTimeout(() => {
    logger.error("[worker] Graceful shutdown timeout — forcing exit")
    process.exit(1)
  }, 30_000)

  // Wait for in-flight jobs to complete, then close Redis connections.
  await Promise.all(allWorkers.map((w) => w.close()))
  clearTimeout(drainTimeout)

  // Close queue connections (each Queue holds its own IORedis client).
  await Promise.all([
    contractExtractQueue.close(),
    contractAiExtractQueue.close(),
    contractEmbedQueue.close(),
    alertsCheckQueue.close(),
    obligationsCheckQueue.close(),
    signingSyncQueue.close(),
    emailQueue.close(),
    notificationFanoutQueue.close(),
    notificationDeliverQueue.close(),
    documentConvertQueue.close(),
    documentExportQueue.close(),
    salesforcePollQueue.close(),
    importProcessQueue.close(),
    obligationExtractQueue.close(),
  ])

  // Disconnect Prisma pools. The app Prisma client is imported by some worker
  // helpers (alerts/check, email senders) — disconnect it too to prevent a
  // dangling pg pool on shutdown.
  await getWorkerPrisma().$disconnect()
  await appPrisma.$disconnect().catch(() => {})

  logger.info("[worker] Graceful shutdown complete")
  process.exit(0)
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
process.on("SIGINT", () => gracefulShutdown("SIGINT"))

logger.info("[worker] ClauseFlow BullMQ worker started")
logger.info(
  { redis: maskRedisUrl(process.env.REDIS_URL ?? "redis://localhost:6379") },
  "[worker] Redis connection",
)
const _provider = process.env.AI_PROVIDER?.toLowerCase() || (
  process.env.ANTHROPIC_API_KEY ? "anthropic"
    : process.env.OPENAI_API_KEY     ? "openai"
    : process.env.OLLAMA_BASE_URL    ? "ollama"
    : "none"
)
logger.info({ provider: _provider }, "[worker] AI provider")
if (!process.env.SMTP_HOST) {
  logger.warn(
    "[worker] SMTP_HOST is not set — reminder and alert emails will be silently skipped. " +
    "In-app notifications and Slack/Teams will still fire. " +
    "Set SMTP_HOST (+ SMTP_USER, SMTP_PASS) in .env.local to enable email delivery.",
  )
}

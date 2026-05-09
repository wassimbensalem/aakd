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

import crypto from "node:crypto"
import { Worker, Job } from "bullmq"
import { PDFParse } from "pdf-parse"
import mammoth from "mammoth"
import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { getWorkerPrisma } from "@/lib/db/worker-client"
import { storage } from "@/lib/storage"
import { checkAndFireAlerts } from "@/lib/alerts/check"
import { generateEmbedding, currentEmbeddingModel } from "@/lib/embedding"
import { getSubmission, isAllowedDocuSealUrl } from "@/lib/docuseal"
import { chunkText } from "@/lib/ai/chunking"
import { sendAlertEmailById } from "@/lib/email"
import { sendApprovalRequestEmail } from "@/lib/email/approval"
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
} from "@/lib/jobs/queues"
import {
  contractAiExtractQueue,
  contractEmbedQueue,
  alertsCheckQueue,
  signingSyncQueue,
  emailQueue,
  notificationFanoutQueue,
  notificationDeliverQueue,
} from "@/lib/jobs/queues"

// ─── Boot check: notification encryption key ─────────────────────────────────
// Refuse to start if the key is missing — silently storing plaintext URLs and
// signing secrets would be a serious security regression.
if (!process.env.NOTIFICATION_ENCRYPTION_KEY) {
  throw new Error("NOTIFICATION_ENCRYPTION_KEY is required")
}

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

    console.log(`[extract] Processing job ${job.id} for contract ${contractId}, file ${fileId}`)

    // 1. Look up the ContractFile to get the mimeType and filename
    const contractFile = await getWorkerPrisma().contractFile.findUnique({
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
      try {
        const result = await mammoth.extractRawText({ buffer })
        extractedText = result.value?.trim() || null
        console.log(`[extract] DOCX text extracted: ${extractedText?.length ?? 0} chars`)
      } catch (err) {
        console.error(`[extract] mammoth failed for file ${fileId}:`, err)
        throw err
      }
    } else {
      console.warn(`[extract] Unsupported mime type ${contractFile.mimeType} for file ${fileId}`)
    }

    // 4. Persist extracted text to the Contract record
    if (extractedText) {
      await getWorkerPrisma().contract.update({
        where: { id: contractId },
        data: { extractedText },
      })

      await getWorkerPrisma().activity.create({
        data: { contractId, userId: null, actorLabel: "System", action: "METADATA_EXTRACTED", detail: `Text extracted from ${contractFile.filename}` },
      })

      // 5. Enqueue AI extraction job
      await contractAiExtractQueue.add("ai_extract", { contractId, extractedText })
      console.log(`[extract] Enqueued ai_extract job for contract ${contractId}`)
    } else {
      // Silent failures (typically scanned/image PDFs) used to disappear into
      // the void — log + write an Activity row so users see why downstream
      // AI features are missing.
      console.warn(
        `[extract] No text extracted for file ${fileId} (contract ${contractId}) — likely a scanned image`,
      )
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
  console.log(`[extract] Job ${job.id} completed`),
)
extractWorker.on("failed", (job, err) =>
  console.error(`[extract] Job ${job?.id} failed:`, err),
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
    console.warn("[ai_extract] No AI provider configured — set AI_PROVIDER or one of ANTHROPIC_API_KEY / OPENAI_API_KEY / OLLAMA_BASE_URL")
    return null
  }

  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) { console.warn("[ai_extract] AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set"); return null }
    const msg = await getAnthropic().messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
      max_tokens: 2048,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Here is the contract text to analyze:\n\n${text}` }],
    })
    const block = msg.content.find((b) => b.type === "text")
    return block?.type === "text" ? block.text.trim() : ""
  }

  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) { console.warn("[ai_extract] AI_PROVIDER=openai but OPENAI_API_KEY is not set"); return null }
    const res = await getOpenAI().chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      max_tokens: 2048,
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

    const limit = getTextLimitForProvider()
    const textToAnalyze =
      extractedText.length > limit ? extractedText.slice(0, limit) : extractedText
    if (extractedText.length > limit) {
      console.log(
        `[ai_extract] Truncated contract text from ${extractedText.length} to ${limit} chars for provider ${process.env.AI_PROVIDER ?? "(auto)"}`,
      )
    }

    let rawJson: string
    try {
      const result = await callExtractionLLM(textToAnalyze)
      if (result === null) {
        console.warn(
          `[ai_extract] AI extraction skipped for contract ${contractId}: no AI provider configured`,
        )
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
        // Still enqueue embedding so semantic search works without an extractor.
        await contractEmbedQueue.add("embed", { contractId, extractedText: textToAnalyze })
        return
      }
      rawJson = result
    } catch (err) {
      console.error(`[ai_extract] LLM call failed for contract ${contractId}:`, err)
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
      // Embedding generation is independent of metadata extraction — never
      // skip it because the LLM failed, otherwise this contract is silently
      // excluded from semantic search.
      await contractEmbedQueue.add("embed", { contractId, extractedText: textToAnalyze })
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
      console.error(
        `[ai_extract] Failed to parse LLM response as JSON for contract ${contractId}:`,
        rawJson,
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
      await contractEmbedQueue.add("embed", { contractId, extractedText: textToAnalyze })
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
      console.log(`[ai_extract] No fields extracted for contract ${contractId}`)
      await contractEmbedQueue.add("embed", { contractId, extractedText: textToAnalyze })
      return
    }

    const db = getWorkerPrisma()
    await db.$transaction(
      fieldData.map(({ field, data }) =>
        db.aIExtraction.upsert({
          where: { contractId_field: { contractId, field } },
          create: {
            contractId,
            field,
            rawValue: String(data.value),
            confidence: data.confidence,
            sourceText: data.sourceText,
            sourcePage: data.sourcePage,
            extractedBy: "ai",
            status: "pending",
          },
          update: {
            rawValue: String(data.value),
            confidence: data.confidence,
            sourceText: data.sourceText,
            sourcePage: data.sourcePage,
            status: "pending",
          },
        }),
      ),
    )

    await getWorkerPrisma().activity.create({
      data: { contractId, userId: null, actorLabel: "System", action: "METADATA_EXTRACTED", detail: `AI extracted ${fieldData.length} fields` },
    })

    console.log(
      `[ai_extract] Upserted ${fieldData.length} extraction records for contract ${contractId}: ${fieldData.map((f) => f.field).join(", ")}`,
    )

    // Enqueue embedding generation after AI extraction
    await contractEmbedQueue.add("embed", { contractId, extractedText: textToAnalyze })
    console.log(`[ai_extract] Enqueued embed job for contract ${contractId}`)

    // Fan out the contract.extracted event — system-actor (no user)
    await enqueueNotification("contract.extracted", contractId, null, {})
  },
  { connection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } } },
)

aiExtractWorker.on("completed", (job) =>
  console.log(`[ai_extract] Job ${job.id} completed`),
)
aiExtractWorker.on("failed", (job, err) =>
  console.error(`[ai_extract] Job ${job?.id} failed:`, err),
)

// ─── Worker: contract.embed ───────────────────────────────────────────────────

const embedWorker = new Worker<ContractEmbedJobData>(
  "contract.embed",
  async (job: Job<ContractEmbedJobData>) => {
    const { contractId, extractedText } = job.data

    console.log(`[embed] Processing job ${job.id} for contract ${contractId}`)

    const embedding = await generateEmbedding(extractedText)
    if (!embedding) {
      console.warn(`[embed] No embedding provider configured — skipping ${contractId}`)
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
        console.error(`[embed] Chunk ${chunk.index} failed for contract ${contractId}:`, err)
        failures += 1
      }
    }

    if (collected.length === 0) {
      console.warn(
        `[embed] All ${chunks.length} chunk embeddings failed for contract ${contractId} — leaving existing rows intact`,
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
      console.log(`[embed] Embedded contract ${contractId} (${embedding.length} dims, 0 new chunks)`)
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
      console.warn(
        `[embed] ${failures}/${chunks.length} chunks failed for contract ${contractId}`,
      )
    }

    console.log(
      `[embed] Embedded contract ${contractId} (${embedding.length} dims, ${collected.length}/${chunks.length} chunks)`,
    )
  },
  { connection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } } },
)

embedWorker.on("completed", (job) =>
  console.log(`[embed] Job ${job.id} completed`),
)
embedWorker.on("failed", (job, err) =>
  console.error(`[embed] Job ${job?.id} failed:`, err),
)

// ─── Worker: alerts.check ─────────────────────────────────────────────────────

const alertsWorker = new Worker<AlertsCheckJobData>(
  "alerts.check",
  async (job: Job<AlertsCheckJobData>) => {
    console.log(`[alerts] Running check job ${job.id} (triggered: ${job.data.triggeredAt})`)
    const { fired, errors } = await checkAndFireAlerts()
    console.log(`[alerts] Fired ${fired} alerts, ${errors} errors`)
  },
  { connection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } } },
)

alertsWorker.on("completed", (job) =>
  console.log(`[alerts] Job ${job.id} completed`),
)
alertsWorker.on("failed", (job, err) =>
  console.error(`[alerts] Job ${job?.id} failed:`, err),
)

// ─── Worker: signing.sync ─────────────────────────────────────────────────────

type SyncableContract = {
  id: string
  organizationId: string
  ownerId: string
  docusealSubmissionId: string | null
  signingStatus: string | null
}

function normalizeDocuSealStatus(status: string): "completed" | "declined" | "expired" | "failed" | "sent" {
  const normalized = status.toLowerCase()
  if (normalized === "completed") return "completed"
  if (normalized === "declined") return "declined"
  if (normalized === "expired") return "expired"
  if (normalized === "failed") return "failed"
  return "sent"
}

async function persistSignedDocument(contract: SyncableContract, documentUrl: string) {
  // SSRF guard: only fetch from the configured DocuSeal host
  if (!isAllowedDocuSealUrl(documentUrl)) {
    throw new Error(`Rejected signed document URL from disallowed host: ${documentUrl}`)
  }

  const signedRes = await fetch(documentUrl)
  if (!signedRes.ok) {
    throw new Error(`Failed to download signed PDF: ${signedRes.status}`)
  }

  const buffer = Buffer.from(await signedRes.arrayBuffer())
  const newKey = storage.storageKey(
    contract.organizationId,
    contract.id,
    `signed_${Date.now()}.pdf`,
  )
  await storage.upload(newKey, buffer, "application/pdf")

  const db = getWorkerPrisma()
  const latestFile = await db.contractFile.findFirst({
    where: { contractId: contract.id, isLatest: true },
    orderBy: { version: "desc" },
    select: { id: true, version: true },
  })

  const nextVersion = (latestFile?.version ?? 0) + 1

  await db.$transaction([
    ...(latestFile
      ? [
          db.contractFile.update({
            where: { id: latestFile.id },
            data: { isLatest: false },
          }),
        ]
      : []),
    db.contractFile.create({
      data: {
        contractId: contract.id,
        filename: "signed_document.pdf",
        storageKey: newKey,
        mimeType: "application/pdf",
        sizeBytes: buffer.length,
        isSigned: true,
        isLatest: true,
        version: nextVersion,
        uploadedById: contract.ownerId,
      },
    }),
    db.contract.update({
      where: { id: contract.id },
      data: {
        status: "ACTIVE",
        signingStatus: "completed",
        signingUrl: null,
      },
    }),
  ])

  await db.activity.create({
    data: {
      contractId: contract.id,
      userId: null,
      actorLabel: "System",
      action: "SIGNED",
      detail: `Contract signed via DocuSeal sync (submission #${contract.docusealSubmissionId})`,
    },
  })

  // Fan out contract.signed — system-actor; recipients resolved by fanout worker
  await enqueueNotification("contract.signed", contract.id, null, {})
}

async function syncDocuSealContract(contract: SyncableContract) {
  if (!contract.docusealSubmissionId) return

  const submission = await getSubmission(Number(contract.docusealSubmissionId))
  if (!submission) return

  const signingStatus = normalizeDocuSealStatus(submission.status)
  if (signingStatus === contract.signingStatus) return

  if (signingStatus !== "completed") {
    await getWorkerPrisma().contract.update({
      where: { id: contract.id },
      data: { signingStatus },
    })
    return
  }

  const signedDocUrl = submission.documents?.[0]?.url
  if (!signedDocUrl) {
    console.warn(`[signing] Submission ${contract.docusealSubmissionId} is completed but has no document URL`)
    return
  }

  await persistSignedDocument(contract, signedDocUrl)
}

const signingWorker = new Worker<SigningSyncJobData>(
  "signing.sync",
  async (job: Job<SigningSyncJobData>) => {
    console.log(`[signing] Running sync job ${job.id} (triggered: ${job.data.triggeredAt})`)

    const where = job.data.contractId
      ? { id: job.data.contractId }
      : job.data.submissionId
        ? { docusealSubmissionId: job.data.submissionId }
        : {
            docusealSubmissionId: { not: null },
            OR: [{ signingStatus: null }, { signingStatus: { not: "completed" } }],
          }

    const contracts = await getWorkerPrisma().contract.findMany({
      where,
      select: {
        id: true,
        organizationId: true,
        ownerId: true,
        docusealSubmissionId: true,
        signingStatus: true,
      },
      take: job.data.contractId || job.data.submissionId ? 1 : 100,
    })

    for (const contract of contracts) {
      try {
        await syncDocuSealContract(contract)
      } catch (err) {
        console.error(`[signing] Failed to sync contract ${contract.id}:`, err)
      }
    }

    console.log(`[signing] Synced ${contracts.length} DocuSeal submission(s)`)
  },
  { connection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } } },
)

signingWorker.on("completed", (job) =>
  console.log(`[signing] Job ${job.id} completed`),
)
signingWorker.on("failed", (job, err) =>
  console.error(`[signing] Job ${job?.id} failed:`, err),
)

// ─── Worker: email.send ───────────────────────────────────────────────────────

const emailWorker = new Worker<EmailJobData>(
  "email.send",
  async (job: Job<EmailJobData>) => {
    const data = job.data
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
  },
  { connection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } } },
)

emailWorker.on("completed", (job) =>
  console.log(`[email] Job ${job.id} completed`),
)
emailWorker.on("failed", (job, err) =>
  console.error(`[email] Job ${job?.id} failed:`, err),
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
    console.log(`[fanout] ${eventName} contract=${contractId} actor=${actorId ?? "system"}`)

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
      console.warn(`[fanout] Contract ${contractId} not found — skipping`)
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
        console.error(`[fanout] failed to decrypt signingSecret for webhook ${wh.id}:`, err)
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
  },
  { connection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } } },
)

fanoutWorker.on("completed", (job) =>
  console.log(`[fanout] Job ${job.id} completed`),
)
fanoutWorker.on("failed", (job, err) =>
  console.error(`[fanout] Job ${job?.id} failed:`, err),
)

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
        console.warn(`[deliver] channel ${data.channelId} missing or disabled`)
        return
      }

      let plaintextUrl: string
      try {
        plaintextUrl = decrypt(channel.webhookUrl)
      } catch (err) {
        console.error(`[deliver] failed to decrypt webhookUrl for channel ${data.channelId}:`, err)
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
        console.warn(`[deliver] unknown channelType="${channel.channelType}" for channel ${data.channelId}`)
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
        console.warn(`[deliver] webhook ${data.webhookId} missing or disabled`)
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
        console.error(`[deliver] failed to decrypt webhook URL for ${data.webhookId}:`, err)
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
        console.error(`[deliver] webhook ${data.webhookId} attempt ${data.attempt} failed:`, err)
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
  console.log(`[deliver] Job ${job.id} completed`),
)
deliverWorker.on("failed", (job, err) =>
  console.error(`[deliver] Job ${job?.id} failed:`, err),
)

// Register the daily cron (9 AM UTC). BullMQ deduplicates by name + pattern,
// so restarting the worker is safe — no stacking of duplicate schedules.
alertsCheckQueue.add(
  "daily-check",
  { triggeredAt: new Date().toISOString() },
  { repeat: { pattern: "0 9 * * *" } },
).then(() => console.log("[alerts] Daily cron registered (0 9 * * *)"))
  .catch((err) => console.error("[alerts] Failed to register cron:", err))

// Webhooks are the primary path, but this periodic sync recovers missed or
// delayed DocuSeal callbacks.
signingSyncQueue.add(
  "poll-docuseal",
  { triggeredAt: new Date().toISOString() },
  { repeat: { pattern: "*/15 * * * *" } },
).then(() => console.log("[signing] Sync cron registered (*/15 * * * *)"))
  .catch((err) => console.error("[signing] Failed to register sync cron:", err))

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown() {
  console.log("[worker] Shutting down gracefully…")
  await extractWorker.close()
  await aiExtractWorker.close()
  await embedWorker.close()
  await alertsWorker.close()
  await signingWorker.close()
  await emailWorker.close()
  await fanoutWorker.close()
  await deliverWorker.close()
  await contractAiExtractQueue.close()
  await contractEmbedQueue.close()
  await alertsCheckQueue.close()
  await signingSyncQueue.close()
  await emailQueue.close()
  await notificationFanoutQueue.close()
  await notificationDeliverQueue.close()
  await getWorkerPrisma().$disconnect()
  process.exit(0)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

console.log("[worker] ClauseFlow BullMQ worker started")
console.log(`[worker] Redis: ${maskRedisUrl(process.env.REDIS_URL ?? "redis://localhost:6379")}`)
const _provider = process.env.AI_PROVIDER?.toLowerCase() || (
  process.env.ANTHROPIC_API_KEY ? "anthropic"
    : process.env.OPENAI_API_KEY     ? "openai"
    : process.env.OLLAMA_BASE_URL    ? "ollama"
    : "none"
)
console.log(`[worker] AI provider: ${_provider}`)

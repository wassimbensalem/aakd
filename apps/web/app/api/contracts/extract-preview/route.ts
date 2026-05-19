import { resolveAuth } from "@/lib/auth/middleware"
import { resolveAiConfig } from "@/lib/ai/resolve"
import { logger } from "@/lib/logger"
import { captureServerEvent } from "@/lib/posthog-server"
import OpenAI from "openai"
import Anthropic from "@anthropic-ai/sdk"
import pdfParse from "pdf-parse"
import mammoth from "mammoth"

const MAX_SIZE = 50 * 1024 * 1024 // 50 MB
const MAX_TEXT_CHARS = 8000

function detectFileType(buffer: Buffer): "pdf" | "docx" | null {
  // PDF: %PDF magic bytes
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return "pdf"
  }
  // PK ZIP header — check for DOCX "word/" entry
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    if (buffer.includes(Buffer.from("word/"))) {
      return "docx"
    }
  }
  return null
}

async function extractText(buffer: Buffer, fileType: "pdf" | "docx"): Promise<string> {
  if (fileType === "pdf") {
    const result = await pdfParse(buffer)
    return result.text
  }
  // DOCX
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

interface ExtractionResult {
  title?: string | null
  contractType?: string | null
  counterpartyName?: string | null
  startDate?: string | null
  endDate?: string | null
  value?: number | null
  currency?: string | null
  paymentTerms?: string | null
  governingLaw?: string | null
  autoRenewal?: boolean
  description?: string | null
  confidence?: Record<string, number>
  error?: string
  partial?: boolean
}

const SYSTEM_PROMPT =
  "Extract key contract metadata from the following contract text. Return a JSON object with these exact keys: title (string), contractType (one of: NDA, MSA, SOW, EMPLOYMENT, VENDOR, CUSTOMER, OTHER), counterpartyName (string), startDate (ISO date string or null), endDate (ISO date string or null), value (number or null), currency (one of: USD, EUR, GBP, JPY, OTHER), paymentTerms (string or null), governingLaw (string or null), autoRenewal (boolean), description (1-2 sentence summary). Also include a confidence object with keys matching the above fields and values 0-1. Return only valid JSON, no markdown."

async function runAiExtraction(
  contractText: string,
  organizationId: string,
): Promise<ExtractionResult> {
  const aiConfig = await resolveAiConfig(organizationId)

  if (!aiConfig.provider || !aiConfig.apiKey) {
    return { error: "ai_unavailable", partial: true, confidence: {} }
  }

  if (aiConfig.provider === "anthropic") {
    const anthropic = new Anthropic({ apiKey: aiConfig.apiKey })
    const msg = await anthropic.messages.create({
      model: aiConfig.model ?? "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `${SYSTEM_PROMPT}\n\n${contractText}`,
        },
      ],
    })
    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}"
    // Strip markdown fences if model returned them despite instructions
    const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()
    return JSON.parse(clean) as ExtractionResult
  }

  if (aiConfig.provider === "openai") {
    const openai = new OpenAI({ apiKey: aiConfig.apiKey })
    const response = await openai.chat.completions.create({
      model: aiConfig.model ?? "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: contractText },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    })
    const raw = response.choices[0]?.message?.content ?? "{}"
    return JSON.parse(raw) as ExtractionResult
  }

  // Ollama: not supported for structured extraction preview
  return { error: "ai_unavailable", partial: true, confidence: {} }
}

// POST /api/contracts/extract-preview
// Body: multipart FormData with field "file"
export async function POST(req: Request): Promise<Response> {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  let formData: globalThis.FormData
  try {
    formData = await req.formData()
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 })
  }

  const fileField = formData.get("file")
  if (!fileField || !(fileField instanceof File)) {
    return Response.json({ error: "Missing file field" }, { status: 400 })
  }

  if (fileField.size > MAX_SIZE) {
    return Response.json({ error: "File exceeds 50 MB limit" }, { status: 413 })
  }

  const buffer = Buffer.from(await fileField.arrayBuffer())
  const fileType = detectFileType(buffer)

  if (!fileType) {
    return Response.json({ error: "unsupported_file_type" }, { status: 400 })
  }

  const fileNameWithoutExt = fileField.name.replace(/\.[^.]+$/, "")

  let contractText = ""
  try {
    const raw = await extractText(buffer, fileType)
    contractText = raw.slice(0, MAX_TEXT_CHARS)
  } catch (err) {
    logger.error({ err }, "[extract-preview] text extraction failed")
    return Response.json({
      title: fileNameWithoutExt,
      error: "text_extraction_failed",
      partial: true,
      confidence: {},
    })
  }

  try {
    const extracted = await runAiExtraction(contractText, ctx.organizationId)
    if (!extracted.error) {
      captureServerEvent(ctx.userId, "ai_extraction_run", {
        organizationId: ctx.organizationId,
      })
    }
    return Response.json(extracted)
  } catch (err) {
    logger.error({ err }, "[extract-preview] AI extraction failed")
    return Response.json({
      title: fileNameWithoutExt,
      error: "ai_unavailable",
      partial: true,
      confidence: {},
    })
  }
}

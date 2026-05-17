import crypto from "node:crypto"
import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { storage } from "@/lib/storage"
import { parseCsv, suggestColumnMapping } from "@/lib/types/import-helpers"
import { logger } from "@/lib/logger"

const MAX_CSV_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_ROWS = 1000

export async function POST(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return Response.json({ error: "invalid_form_data" }, { status: 400 })
  }

  const file = formData.get("file")
  if (!(file instanceof File)) {
    return Response.json({ error: "no_file" }, { status: 400 })
  }

  const isCsv =
    file.type === "text/csv" ||
    file.type === "application/vnd.ms-excel" ||
    file.name.toLowerCase().endsWith(".csv")
  if (!isCsv) {
    return Response.json({ error: "invalid_csv" }, { status: 422 })
  }

  if (file.size > MAX_CSV_BYTES) {
    return Response.json(
      { error: "file_too_large", maxBytes: MAX_CSV_BYTES },
      { status: 422 },
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const text = buffer.toString("utf-8")

  let rows: string[][]
  try {
    rows = parseCsv(text).filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ""))
  } catch {
    return Response.json({ error: "invalid_csv" }, { status: 422 })
  }

  if (rows.length === 0 || rows[0].length === 0) {
    return Response.json({ error: "invalid_csv" }, { status: 422 })
  }

  const headers = rows[0].map((h) => h.trim())
  const dataRows = rows.slice(1)

  if (dataRows.length > MAX_ROWS) {
    return Response.json(
      { error: "csv_too_large", maxRows: MAX_ROWS, actualRows: dataRows.length },
      { status: 422 },
    )
  }

  const previewId = crypto.randomUUID()
  const storageKey = `imports/${ctx.organizationId}/previews/${previewId}/source.csv`

  try {
    await storage.upload(storageKey, buffer, "text/csv")
  } catch (err) {
    logger.error({ err, storageKey }, "[import.csv.preview] storage upload failed")
    return Response.json({ error: "storage_failed" }, { status: 502 })
  }

  return Response.json({
    previewId,
    headers,
    suggestedMapping: suggestColumnMapping(headers),
    previewRows: dataRows.slice(0, 5),
    totalRows: dataRows.length,
    storageKey,
  })
}

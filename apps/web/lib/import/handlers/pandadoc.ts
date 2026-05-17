/**
 * PandaDoc export ZIP import handler.
 *
 * Expects: <folder>/metadata.json + <folder>/document.{pdf|docx} pairs in the archive.
 * Maps PandaDoc's metadata schema to ClauseFlow contract fields per the spec.
 */
import { unzipSync } from "fflate"
import type { ImportJob } from "@prisma/client"

import { getWorkerPrisma } from "@/lib/db/worker-client"
import { storage } from "@/lib/storage"
import { createImportedContract } from "../create-contract"
import { detectFileKind, mimeForKind } from "../magic-bytes"
import { parseImportDate, parseCurrency } from "../parse-utils"
import type { ImportProcessContext } from "../processor"

const MAX_DOCUMENTS = 50

interface PandaDocMetadata {
  name?: string
  status?: string
  expiration_date?: string
  pricing?: { total?: { amount?: number }; currency?: string }
  recipients?: Array<{
    company_name?: string
    first_name?: string
    last_name?: string
    email?: string
  }>
  fields?: { start_date?: { value?: string } }
}

interface DocumentDir {
  dir: string
  metadata: PandaDocMetadata | null
  fileBuffer: Buffer | null
  fileName: string | null
}

export async function runPandadocHandler(
  job: ImportJob,
  ctx: ImportProcessContext,
): Promise<void> {
  if (!job.storageKey) {
    throw new Error("PandaDoc import job is missing storageKey")
  }

  const url = await storage.getSignedDownloadUrl(job.storageKey, 600)
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to download ZIP from storage: ${res.status}`)
  }
  const zipBuffer = Buffer.from(await res.arrayBuffer())

  let entries: ReturnType<typeof unzipSync>
  try {
    entries = unzipSync(zipBuffer)
  } catch (err) {
    throw new Error(`zip_extract_failed: ${(err as Error).message}`)
  }

  // Group entries by document directory.
  const dirs = new Map<string, DocumentDir>()
  for (const [path, content] of Object.entries(entries)) {
    if (path.startsWith("__MACOSX/") || path.includes(".DS_Store")) continue
    const parts = path.split("/")
    if (parts.length < 2) continue
    const dirKey = parts.slice(0, -1).join("/")
    const file = parts[parts.length - 1].toLowerCase()
    if (!file) continue

    let entry = dirs.get(dirKey)
    if (!entry) {
      entry = { dir: dirKey, metadata: null, fileBuffer: null, fileName: null }
      dirs.set(dirKey, entry)
    }

    if (file === "metadata.json") {
      try {
        const text = Buffer.from(content).toString("utf8")
        entry.metadata = JSON.parse(text) as PandaDocMetadata
      } catch {
        entry.metadata = null
      }
    } else if (file === "document.pdf" || file === "document.docx") {
      entry.fileBuffer = Buffer.from(content)
      entry.fileName = file
    }
  }

  // Filter to directories that have BOTH a metadata file and a document file.
  const candidates = Array.from(dirs.values()).filter(
    (e) => e.metadata && e.fileBuffer && e.fileName,
  )

  if (candidates.length === 0) {
    throw new Error("not_a_pandadoc_export")
  }

  const db = getWorkerPrisma()
  await db.importJob.update({
    where: { id: job.id },
    data: { totalRows: candidates.length },
  })

  const head = candidates.slice(0, MAX_DOCUMENTS)
  const tail = candidates.slice(MAX_DOCUMENTS)

  let succeeded = 0
  let failed = 0

  for (let i = 0; i < head.length; i++) {
    const rowIndex = i + 1
    const doc = head[i]
    try {
      const data = mapPandaDoc(doc)
      const contractId = await createImportedContract(data, {
        organizationId: ctx.organizationId,
        ownerId: ctx.createdById,
      })
      await db.importRow.create({
        data: {
          jobId: job.id,
          rowIndex,
          sourceRef: doc.dir,
          status: "success",
          contractId,
        },
      })
      succeeded += 1
    } catch (err) {
      await db.importRow.create({
        data: {
          jobId: job.id,
          rowIndex,
          sourceRef: doc.dir,
          status: "failed",
          errorMessage: (err as Error).message || "unknown_error",
        },
      })
      failed += 1
    }
  }

  for (let i = 0; i < tail.length; i++) {
    const rowIndex = MAX_DOCUMENTS + i + 1
    await db.importRow.create({
      data: {
        jobId: job.id,
        rowIndex,
        sourceRef: tail[i].dir,
        status: "skipped",
        errorMessage: "batch_limit_exceeded",
      },
    })
  }

  await db.importJob.update({
    where: { id: job.id },
    data: {
      totalRows: candidates.length,
      succeededRows: succeeded,
      failedRows: failed,
    },
  })
}

function mapPandaDoc(doc: DocumentDir) {
  const meta = doc.metadata!
  const file = doc.fileBuffer!
  const fileName = doc.fileName!

  const kind = detectFileKind(file, fileName)
  if (kind !== "pdf" && kind !== "docx") {
    throw new Error("unsupported_file_type")
  }

  // Title — prefer metadata.name, fall back to the directory name.
  const dirBase = doc.dir.split("/").pop() || "Untitled"
  const title = (meta.name?.trim() || dirBase).slice(0, 500)

  // Counterparty — prefer first recipient's company_name, else first+last name.
  const firstRecipient = meta.recipients?.[0]
  const counterpartyName = firstRecipient?.company_name?.trim()
    ? firstRecipient.company_name.trim()
    : [firstRecipient?.first_name, firstRecipient?.last_name]
        .filter(Boolean)
        .join(" ")
        .trim() || undefined

  const counterpartyContact = firstRecipient?.email?.trim() || undefined

  const value =
    typeof meta.pricing?.total?.amount === "number" && Number.isFinite(meta.pricing.total.amount)
      ? meta.pricing.total.amount
      : undefined

  const currency = parseCurrency(meta.pricing?.currency) || "USD"

  const startDate = meta.fields?.start_date?.value
    ? parseImportDate(meta.fields.start_date.value)
    : null
  const endDate = meta.expiration_date ? parseImportDate(meta.expiration_date) : null

  const status = meta.status === "document.completed" ? "ACTIVE" : "DRAFT"

  return {
    title,
    counterpartyName,
    counterpartyContact,
    value,
    currency,
    startDate: startDate ?? undefined,
    endDate: endDate ?? undefined,
    status,
    file: {
      buffer: file,
      filename: fileName,
      mimeType: mimeForKind(kind),
      sizeBytes: file.length,
    },
  }
}

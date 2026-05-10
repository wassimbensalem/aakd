/**
 * Batch file import handler — covers BATCH_FILES (ZIP or multi-upload via S3
 * manifest) and GOOGLE_DRIVE (download from Drive API, otherwise identical).
 */
import { unzipSync } from "fflate"
import type { ImportJob } from "@prisma/client"

import { getWorkerPrisma } from "@/lib/db/worker-client"
import { storage } from "@/lib/storage"
import { createImportedContract, sanitizeFilename } from "../create-contract"
import { detectFileKind, mimeForKind } from "../magic-bytes"
import { downloadDriveFile } from "../gdrive-client"
import type { ImportProcessContext } from "../processor"

const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_TOTAL_BYTES = 500 * 1024 * 1024
const MAX_FILES = 50

export async function runBatchHandler(
  job: ImportJob,
  ctx: ImportProcessContext,
): Promise<void> {
  if (job.source === "GOOGLE_DRIVE") {
    return handleGoogleDrive(job, ctx)
  }

  if (!job.storageKey) {
    throw new Error("BATCH_FILES import job is missing storageKey")
  }

  if (job.storageKey.endsWith(".zip")) {
    return handleZip(job, ctx)
  }

  // Multi-file upload — manifest.json
  return handleManifest(job, ctx)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface FileLike {
  buffer: Buffer
  filename: string
  sourceRef: string
}

async function processFiles(
  job: ImportJob,
  ctx: ImportProcessContext,
  files: FileLike[],
): Promise<void> {
  const db = getWorkerPrisma()
  let succeeded = 0
  let failed = 0
  const skippedTail: FileLike[] = []

  // Spec: max 50 valid entries per batch — extras are recorded as `skipped`.
  const head = files.slice(0, MAX_FILES)
  if (files.length > MAX_FILES) {
    skippedTail.push(...files.slice(MAX_FILES))
  }

  for (let i = 0; i < head.length; i++) {
    const rowIndex = i + 1
    const f = head[i]
    try {
      if (f.buffer.length > MAX_FILE_BYTES) {
        throw new Error("file_too_large")
      }
      const kind = detectFileKind(f.buffer, f.filename)
      if (kind !== "pdf" && kind !== "docx") {
        throw new Error("unsupported_file_type")
      }
      const titleBase = stripExtension(f.filename).replace(/[_\-]+/g, " ").trim() || "Untitled"

      const contractId = await createImportedContract(
        {
          title: titleBase.slice(0, 500),
          file: {
            buffer: f.buffer,
            filename: f.filename,
            mimeType: mimeForKind(kind),
            sizeBytes: f.buffer.length,
          },
        },
        { organizationId: ctx.organizationId, ownerId: ctx.createdById },
      )

      await db.importRow.create({
        data: {
          jobId: job.id,
          rowIndex,
          sourceRef: f.sourceRef,
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
          sourceRef: f.sourceRef,
          status: "failed",
          errorMessage: (err as Error).message || "unknown_error",
        },
      })
      failed += 1
    }

    // Stream progress every file so the UI poll sees it grow.
    if ((succeeded + failed) % 5 === 0) {
      await db.importJob.update({
        where: { id: job.id },
        data: { succeededRows: succeeded, failedRows: failed },
      })
    }
  }

  for (let i = 0; i < skippedTail.length; i++) {
    const rowIndex = MAX_FILES + i + 1
    await db.importRow.create({
      data: {
        jobId: job.id,
        rowIndex,
        sourceRef: skippedTail[i].sourceRef,
        status: "skipped",
        errorMessage: "batch_limit_exceeded",
      },
    })
  }

  await db.importJob.update({
    where: { id: job.id },
    data: {
      totalRows: files.length,
      succeededRows: succeeded,
      failedRows: failed,
    },
  })
}

function stripExtension(name: string): string {
  return name.replace(/\.(pdf|docx|PDF|DOCX)$/, "")
}

// ─── ZIP path ────────────────────────────────────────────────────────────────

async function handleZip(job: ImportJob, ctx: ImportProcessContext): Promise<void> {
  const url = await storage.getSignedDownloadUrl(job.storageKey!, 600)
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

  const candidates: FileLike[] = []
  let totalSize = 0
  for (const [path, content] of Object.entries(entries)) {
    if (shouldSkipEntry(path)) continue
    const lower = path.toLowerCase()
    if (!lower.endsWith(".pdf") && !lower.endsWith(".docx")) continue

    totalSize += content.byteLength
    if (totalSize > MAX_TOTAL_BYTES) {
      // Spec: total uncompressed size must not exceed 500 MB — abort the job.
      const db = getWorkerPrisma()
      await db.importJob.update({
        where: { id: job.id },
        data: { status: "FAILED", completedAt: new Date() },
      })
      throw new Error("total_size_too_large")
    }

    candidates.push({
      buffer: Buffer.from(content),
      filename: basename(path),
      sourceRef: path,
    })
  }

  if (candidates.length === 0) {
    throw new Error("no_valid_files_in_zip")
  }

  await processFiles(job, ctx, candidates)
}

function shouldSkipEntry(path: string): boolean {
  if (path.startsWith("__MACOSX/")) return true
  if (path.includes("/.DS_Store") || path.endsWith(".DS_Store")) return true
  // Zip-slip protection — anything that escapes the archive root is hostile.
  if (path.startsWith("/") || path.includes("../") || path.includes("..\\")) return true
  if (path.endsWith("/")) return true // directory entries
  return false
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/")
  return idx >= 0 ? path.slice(idx + 1) : path
}

// ─── Manifest path (multi-file POST) ─────────────────────────────────────────

async function handleManifest(job: ImportJob, ctx: ImportProcessContext): Promise<void> {
  const url = await storage.getSignedDownloadUrl(job.storageKey!, 600)
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to download manifest from storage: ${res.status}`)
  }
  const manifest = (await res.json()) as Array<{ key: string; filename: string }>
  if (!Array.isArray(manifest)) {
    throw new Error("manifest_invalid")
  }

  const files: FileLike[] = []
  for (const entry of manifest) {
    if (!entry?.key || !entry?.filename) continue
    const dlUrl = await storage.getSignedDownloadUrl(entry.key, 600)
    const dlRes = await fetch(dlUrl)
    if (!dlRes.ok) {
      // Tag this entry as failed without aborting the run — manifest entries
      // are independent.
      files.push({
        buffer: Buffer.alloc(0),
        filename: entry.filename,
        sourceRef: entry.key,
      })
      continue
    }
    const buffer = Buffer.from(await dlRes.arrayBuffer())
    files.push({ buffer, filename: entry.filename, sourceRef: entry.key })
  }

  if (files.length === 0) {
    throw new Error("manifest_empty")
  }

  await processFiles(job, ctx, files)
}

// ─── Google Drive path ───────────────────────────────────────────────────────

async function handleGoogleDrive(job: ImportJob, ctx: ImportProcessContext): Promise<void> {
  const db = getWorkerPrisma()
  if (!job.driveFileIds) {
    throw new Error("GOOGLE_DRIVE import is missing driveFileIds")
  }

  const integration = await db.googleDriveIntegration.findUnique({
    where: { organizationId: ctx.organizationId },
    select: {
      id: true,
      accessToken: true,
      refreshToken: true,
      tokenExpiresAt: true,
    },
  })
  if (!integration) {
    throw new Error("google_drive_not_connected")
  }

  const fileIds = job.driveFileIds.split(",").map((s) => s.trim()).filter(Boolean)
  const files: FileLike[] = []

  for (const fileId of fileIds) {
    try {
      const dl = await downloadDriveFile(integration, fileId)
      files.push({
        buffer: dl.buffer,
        filename: sanitizeFilename(dl.name),
        sourceRef: `drive:${fileId}`,
      })
    } catch (err) {
      // Record an immediate failure row — we can't add it via processFiles
      // because that path expects a buffer.
      files.push({
        buffer: Buffer.alloc(0),
        filename: `drive_${fileId}.bin`,
        sourceRef: `drive:${fileId}:${(err as Error).message}`,
      })
    }
  }

  if (files.length === 0) {
    throw new Error("no_files_selected")
  }

  await processFiles(job, ctx, files)
}

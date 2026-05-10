import crypto from "node:crypto"
import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { storage } from "@/lib/storage"
import { isZipBuffer, sanitizeFilename } from "@/lib/types/import-helpers"
import { enqueueImportProcess } from "@/lib/types/import-queue"

const MAX_ZIP_BYTES = 500 * 1024 * 1024 // 500 MB
const MAX_FILE_BYTES = 50 * 1024 * 1024 // 50 MB
const MAX_FILES = 50
const MAX_TOTAL_BYTES = 500 * 1024 * 1024

function isZipFile(file: File): boolean {
  return (
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed" ||
    file.name.toLowerCase().endsWith(".zip")
  )
}

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

  const single = formData.get("file")
  const multiple = formData.getAll("files[]").filter((v): v is File => v instanceof File)

  return requestContext.run(ctx, async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const importJobModel = prisma.importJob
    const jobId = crypto.randomUUID()

    if (single instanceof File && isZipFile(single)) {
      if (single.size > MAX_ZIP_BYTES) {
        return Response.json(
          { error: "file_too_large", maxBytes: MAX_ZIP_BYTES },
          { status: 422 },
        )
      }

      const buffer = Buffer.from(await single.arrayBuffer())
      if (!isZipBuffer(buffer)) {
        return Response.json({ error: "not_a_zip" }, { status: 422 })
      }

      const storageKey = `imports/${ctx.organizationId}/${jobId}/source.zip`
      try {
        await storage.upload(storageKey, buffer, "application/zip")
      } catch (err) {
        console.error("[import.batch] storage upload failed:", err)
        return Response.json({ error: "storage_failed" }, { status: 502 })
      }

      const job = await importJobModel.create({
        data: {
          id: jobId,
          organizationId: ctx.organizationId,
          source: "BATCH_FILES",
          status: "PENDING",
          storageKey,
          totalRows: 0,
          createdById: ctx.userId,
        },
        select: { id: true, totalRows: true },
      })

      try {
        await enqueueImportProcess({
          importJobId: job.id,
          organizationId: ctx.organizationId,
          createdById: ctx.userId,
        })
      } catch (err) {
        console.error("[import.batch] enqueue failed:", err)
      }

      return Response.json({ jobId: job.id, totalRows: job.totalRows }, { status: 201 })
    }

    if (multiple.length === 0) {
      return Response.json({ error: "no_files" }, { status: 400 })
    }

    if (multiple.length > MAX_FILES) {
      return Response.json(
        { error: "too_many_files", maxFiles: MAX_FILES },
        { status: 422 },
      )
    }

    let totalSize = 0
    for (const f of multiple) {
      if (f.size > MAX_FILE_BYTES) {
        return Response.json(
          { error: "file_too_large", filename: f.name, maxBytes: MAX_FILE_BYTES },
          { status: 422 },
        )
      }
      totalSize += f.size
    }
    if (totalSize > MAX_TOTAL_BYTES) {
      return Response.json(
        { error: "total_size_too_large", maxBytes: MAX_TOTAL_BYTES },
        { status: 422 },
      )
    }

    const manifest: { index: number; filename: string; storageKey: string; sizeBytes: number }[] = []
    for (let i = 0; i < multiple.length; i++) {
      const file = multiple[i]
      const sanitized = sanitizeFilename(file.name)
      const key = `imports/${ctx.organizationId}/${jobId}/files/${i}_${sanitized}`
      const buf = Buffer.from(await file.arrayBuffer())
      try {
        await storage.upload(key, buf, file.type || "application/octet-stream")
      } catch (err) {
        console.error("[import.batch] file upload failed:", err)
        return Response.json({ error: "storage_failed" }, { status: 502 })
      }
      manifest.push({ index: i, filename: file.name, storageKey: key, sizeBytes: file.size })
    }

    const manifestKey = `imports/${ctx.organizationId}/${jobId}/manifest.json`
    try {
      await storage.upload(
        manifestKey,
        Buffer.from(JSON.stringify({ files: manifest }), "utf-8"),
        "application/json",
      )
    } catch (err) {
      console.error("[import.batch] manifest upload failed:", err)
      return Response.json({ error: "storage_failed" }, { status: 502 })
    }

    const job = await importJobModel.create({
      data: {
        id: jobId,
        organizationId: ctx.organizationId,
        source: "BATCH_FILES",
        status: "PENDING",
        storageKey: manifestKey,
        totalRows: multiple.length,
        createdById: ctx.userId,
      },
      select: { id: true, totalRows: true },
    })

    try {
      await enqueueImportProcess({
        importJobId: job.id,
        organizationId: ctx.organizationId,
        createdById: ctx.userId,
      })
    } catch (err) {
      console.error("[import.batch] enqueue failed:", err)
    }

    return Response.json({ jobId: job.id, totalRows: job.totalRows }, { status: 201 })
  })
}

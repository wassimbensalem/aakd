import crypto from "node:crypto"
import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { storage } from "@/lib/storage"
import { isZipBuffer } from "@/lib/types/import-helpers"
import { enqueueImportProcess } from "@/lib/types/import-queue"

const MAX_ZIP_BYTES = 500 * 1024 * 1024
const VALID_FORMATS = new Set(["contractbook", "docusign", "auto"])

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
  if (file.size > MAX_ZIP_BYTES) {
    return Response.json(
      { error: "file_too_large", maxBytes: MAX_ZIP_BYTES },
      { status: 422 },
    )
  }

  const formatRaw = formData.get("format")
  const format = typeof formatRaw === "string" ? formatRaw.toLowerCase() : "auto"
  if (!VALID_FORMATS.has(format)) {
    return Response.json({ error: "invalid_format" }, { status: 422 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (!isZipBuffer(buffer)) {
    return Response.json({ error: "not_a_zip" }, { status: 422 })
  }

  return requestContext.run(ctx, async () => {
    const jobId = crypto.randomUUID()
    const storageKey = `imports/${ctx.organizationId}/${jobId}/source.zip`

    try {
      await storage.upload(storageKey, buffer, "application/zip")
    } catch (err) {
      console.error("[import.clm-export] storage upload failed:", err)
      return Response.json({ error: "storage_failed" }, { status: 502 })
    }

    // The selected format is persisted as JSON inside mappingJson so the
    // worker can read it without a schema change beyond what's already
    // planned for M10.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const importJobModel = (prisma as any).importJob
    const job = await importJobModel.create({
      data: {
        id: jobId,
        organizationId: ctx.organizationId,
        source: "CLM_EXPORT",
        status: "PENDING",
        storageKey,
        mappingJson: JSON.stringify({ format }),
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
      console.error("[import.clm-export] enqueue failed:", err)
    }

    return Response.json({ jobId: job.id, totalRows: job.totalRows }, { status: 201 })
  })
}

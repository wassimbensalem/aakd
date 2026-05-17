import crypto from "node:crypto"
import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requireRole } from "@/lib/auth/roles"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { storage } from "@/lib/storage"
import { isZipBuffer } from "@/lib/types/import-helpers"
import { enqueueImportProcess } from "@/lib/types/import-queue"
import { logger } from "@/lib/logger"

const MAX_ZIP_BYTES = 500 * 1024 * 1024

export async function POST(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const roleError = requireRole(ctx.role, "member")
  if (roleError) return roleError
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
      logger.error({ err, storageKey }, "[import.pandadoc] storage upload failed")
      return Response.json({ error: "storage_failed" }, { status: 502 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const importJobModel = prisma.importJob
    const job = await importJobModel.create({
      data: {
        id: jobId,
        organizationId: ctx.organizationId,
        source: "PANDADOC",
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
      logger.error({ err, importJobId: job.id }, "[import.pandadoc] enqueue failed")
    }

    return Response.json({ jobId: job.id, totalRows: job.totalRows }, { status: 201 })
  })
}

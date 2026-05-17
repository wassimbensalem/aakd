import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { storage } from "@/lib/storage"
import { contractExtractQueue, documentConvertQueue } from "@/lib/jobs/queues"
import { enqueueNotification } from "@/lib/notifications/fanout"
import { writeInAppToOrgMembers } from "@/lib/notifications/write-in-app"
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

// GET /api/contracts/[id]/upload?fileId=... — generate a signed download URL
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true },
    })
    if (!contract || contract.organizationId !== ctx.organizationId)
      return Response.json({ error: "Not Found" }, { status: 404 })

    const url = new URL(req.url)
    const fileId = url.searchParams.get("fileId")
    if (!fileId) return Response.json({ error: "fileId required" }, { status: 400 })

    const file = await prisma.contractFile.findUnique({
      where: { id: fileId },
      select: { id: true, contractId: true, storageKey: true },
    })
    if (!file || file.contractId !== params.id)
      return Response.json({ error: "Not Found" }, { status: 404 })

    const signedUrl = await storage.getSignedDownloadUrl(file.storageKey)
    return Response.json({ url: signedUrl })
  })
}

function validateFileType(
  buffer: Buffer,
): "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | null {
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return "application/pdf"
  }
  // PK\x03\x04 = ZIP file header. Any DOCX is a ZIP, but not every ZIP is a DOCX.
  // OOXML docs always contain a "word/" entry in the central directory; reject
  // bare ZIPs (XLSX, ODT, generic .zip renamed to .docx, etc).
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    if (buffer.includes(Buffer.from("word/"))) {
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    }
    return null
  }
  return null
}

const MAX_SIZE = 50 * 1024 * 1024 // 50MB

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  // Rate limit: 20 uploads/min per org (file parsing is expensive)
  const rl = await rateLimit(`${ctx.organizationId}:upload`, 20, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter)

  return requestContext.run(ctx, async () => {
    const existing = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true, title: true },
    })
    // Middleware injects org scope; explicit check for defense-in-depth.
    if (!existing || existing.organizationId !== ctx.organizationId)
      return Response.json({ error: "Not Found" }, { status: 404 })

    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return new Response("Invalid form data", { status: 400 })
    }

    const file = formData.get("file")
    if (!(file instanceof File)) {
      return new Response("Missing file field", { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      return new Response("File exceeds 50MB limit", { status: 413 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const mimeType = validateFileType(buffer)
    if (!mimeType) {
      return new Response("Only PDF and DOCX files are accepted", { status: 415 })
    }

    const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
    const key = storage.storageKey(existing.organizationId, params.id, filename)

    try {
      await storage.upload(key, buffer, mimeType)
    } catch (err) {
      logger.error({ err, contractId: params.id, storageKey: key }, "[upload] storage upload failed")
      return new Response("Storage upload failed", { status: 502 })
    }

    // Atomic: find prior latest, flip it, create new file + version row.
    // Without a transaction, a crash between the updateMany and create leaves
    // the contract with zero rows marked isLatest.
    const { contractFile } = await prisma.$transaction(async (tx) => {
      const latestFile = await tx.contractFile.findFirst({
        where: { contractId: params.id },
        orderBy: { version: "desc" },
        select: { version: true },
      })
      const nextVersion = (latestFile?.version ?? 0) + 1

      await tx.contractFile.updateMany({
        where: { contractId: params.id, isLatest: true },
        data: { isLatest: false },
      })

      const contractFile = await tx.contractFile.create({
        data: {
          contractId: params.id,
          filename,
          storageKey: key,
          mimeType,
          sizeBytes: buffer.byteLength,
          isLatest: true,
          version: nextVersion,
          uploadedById: ctx.userId,
        },
      })

      await tx.contractVersion.create({
        data: {
          contractId: params.id,
          version: nextVersion,
          fileId: contractFile.id,
          createdById: ctx.userId,
          changeNote: `Uploaded ${filename}`,
        },
      })

      return { contractFile }
    })

    await writeActivity(params.id, ctx.userId, "UPLOADED", filename)

    await enqueueNotification("contract.uploaded", params.id, ctx.userId, {})
    // Write in-app notification directly — does not depend on worker being up
    await writeInAppToOrgMembers(
      ctx.organizationId,
      params.id,
      "contract.uploaded",
      "Contract file uploaded",
      `A file was uploaded to "${existing.title}"`,
      ctx.userId, // exclude the uploader
    )

    // Enqueue text extraction job — heavy work must not block the API route
    try {
      await contractExtractQueue.add("extract", {
        contractId: params.id,
        fileId: contractFile.id,
        storageKey: key,
      })
    } catch (err) {
      logger.error({ err, contractId: params.id }, "[upload] failed to enqueue extraction job")
      return Response.json({ ...contractFile, downloadUrl: null, extractionQueued: false }, { status: 201 })
    }

    // Enqueue document.convert so the editor tab is populated after upload.
    // This converts the PDF/DOCX to TipTap JSON and saves it as a ContractDocument.
    const fileType = mimeType === "application/pdf" ? "pdf" : "docx"
    try {
      await documentConvertQueue.add("convert", {
        contractId: params.id,
        storageKey: key,
        requestedById: ctx.userId,
        jobId: contractFile.id,
        fileType,
      })
    } catch (err) {
      // Non-fatal — the extraction job is already queued; the editor will just
      // start blank (user can still write from scratch or re-import later).
      logger.error({ err, contractId: params.id }, "[upload] failed to enqueue document.convert job")
    }

    const downloadUrl = await storage.getSignedDownloadUrl(key)

    return Response.json({ ...contractFile, downloadUrl, extractionQueued: true }, { status: 201 })
  })
}

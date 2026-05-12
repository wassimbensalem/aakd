import crypto from "node:crypto"
import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { storage } from "@/lib/storage"
import { documentConvertQueue } from "@/lib/jobs/queues"

const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25 MB (PDFs can be larger than DOCX)
const DOCX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]) // PK zip header
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46])  // %PDF

const READ_ONLY_STATUSES = new Set([
  "AWAITING_SIGNATURE",
  "ACTIVE",
  "EXPIRED",
  "TERMINATED",
  "ARCHIVED",
])

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError
  if (ctx.role === "viewer") {
    return Response.json({ error: "viewer role cannot import documents" }, { status: 403 })
  }

  return requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true, status: true },
    })
    if (!contract || contract.organizationId !== ctx.organizationId) {
      return new Response("Not Found", { status: 404 })
    }

    if (READ_ONLY_STATUSES.has(contract.status)) {
      return Response.json({ error: "read_only_status" }, { status: 422 })
    }

    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return Response.json({ error: "invalid_form_data" }, { status: 400 })
    }

    const file = formData.get("file")
    if (!file || typeof file === "string") {
      return Response.json({ error: "missing_file" }, { status: 400 })
    }

    const fileSize = (file as File).size
    if (fileSize > MAX_FILE_BYTES) {
      return Response.json({ error: "file_too_large" }, { status: 413 })
    }

    const arrayBuffer = await (file as File).arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Detect file type by magic bytes — never trust the browser MIME type.
    const magic = buffer.subarray(0, 4)
    let fileType: "docx" | "pdf"
    let mimeType: string
    let ext: string

    if (buffer.length >= 4 && magic.equals(DOCX_MAGIC)) {
      fileType = "docx"
      mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ext = "docx"
    } else if (buffer.length >= 4 && magic.equals(PDF_MAGIC)) {
      fileType = "pdf"
      mimeType = "application/pdf"
      ext = "pdf"
    } else {
      return Response.json({ error: "invalid_file_type" }, { status: 422 })
    }

    const tmpKey = `tmp/docx-imports/${params.id}/${crypto.randomUUID()}.${ext}`
    await storage.upload(tmpKey, buffer, mimeType)

    const job = await documentConvertQueue.add("convert", {
      contractId: params.id,
      storageKey: tmpKey,
      requestedById: ctx.userId,
      fileType,
      jobId: "", // overwritten below using the actual BullMQ job id
    })
    // BullMQ assigns the id; pass it back so the GET route can verify ownership
    // by reading job.data.requestedById, and so the client can poll.
    if (job.id) {
      await job.updateData({
        contractId: params.id,
        storageKey: tmpKey,
        requestedById: ctx.userId,
        fileType,
        jobId: job.id,
      })
    }

    return Response.json({ jobId: job.id }, { status: 202 })
  })
}

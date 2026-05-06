import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { writeActivity } from "@/lib/db/activity"
import { storage } from "@/lib/storage"

function validateFileType(
  buffer: Buffer,
): "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | null {
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return "application/pdf"
  }
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  }
  return null
}

const MAX_SIZE = 50 * 1024 * 1024 // 50MB

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const existing = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true },
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

    await storage.upload(key, buffer, mimeType)

    // Find the current latest version number
    const latestFile = await prisma.contractFile.findFirst({
      where: { contractId: params.id },
      orderBy: { version: "desc" },
      select: { version: true },
    })
    const nextVersion = (latestFile?.version ?? 0) + 1

    // Unset previous latest
    await prisma.contractFile.updateMany({
      where: { contractId: params.id, isLatest: true },
      data: { isLatest: false },
    })

    const contractFile = await prisma.contractFile.create({
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

    await prisma.contractVersion.create({
      data: {
        contractId: params.id,
        version: nextVersion,
        fileId: contractFile.id,
        createdById: ctx.userId,
        changeNote: `Uploaded ${filename}`,
      },
    })

    await writeActivity(params.id, ctx.userId, "UPLOADED", filename)

    const downloadUrl = await storage.getSignedDownloadUrl(key)

    return Response.json({ ...contractFile, downloadUrl }, { status: 201 })
  })
}

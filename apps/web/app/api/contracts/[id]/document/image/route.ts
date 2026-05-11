import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { storage } from "@/lib/storage"
import { randomBytes } from "crypto"

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
])
const MAX_SIZE = 5 * 1024 * 1024 // 5 MB

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  return requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true },
    })
    if (!contract || contract.organizationId !== ctx.organizationId) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return Response.json({ error: "Invalid form data" }, { status: 400 })
    }

    const file = formData.get("file")
    if (!(file instanceof File)) {
      return Response.json({ error: "Missing file" }, { status: 400 })
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return Response.json({ error: "invalid_file_type" }, { status: 422 })
    }

    if (file.size > MAX_SIZE) {
      return Response.json({ error: "file_too_large" }, { status: 422 })
    }

    const ext = file.name.split(".").pop() ?? "bin"
    const key = `contracts/${params.id}/images/${randomBytes(8).toString("hex")}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const storedKey = await storage.upload(key, buffer, file.type)

    // Return a signed download URL so the image can be rendered in the editor
    const url = await storage.getSignedDownloadUrl(storedKey)

    return Response.json({ url })
  })
}

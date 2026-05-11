import { resolveAuth } from "@/lib/auth/middleware"
import { hasRole } from "@/lib/auth/roles"
import { storage } from "@/lib/storage"

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_")
}

export async function POST(req: Request): Promise<Response> {
  const ctx = await resolveAuth(req)
  if (!ctx) return new Response("Unauthorized", { status: 401 })

  if (!hasRole(ctx.role, "legal")) {
    return new Response("Forbidden", { status: 403 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return Response.json({ error: "Expected multipart/form-data" }, { status: 400 })
  }

  const file = formData.get("file")
  if (!(file instanceof File)) {
    return Response.json({ error: "Missing file field" }, { status: 400 })
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return Response.json(
      { error: "Only JPEG, PNG, and WebP images are allowed" },
      { status: 400 },
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  if (buffer.byteLength > MAX_BYTES) {
    return Response.json({ error: "File exceeds 2 MB limit" }, { status: 413 })
  }

  const sanitized = sanitizeFilename(file.name || "logo")
  const key = `orgs/${ctx.organizationId}/logo/${Date.now()}_${sanitized}`

  await storage.upload(key, buffer, file.type)

  const url = `/api/org/logo?key=${encodeURIComponent(key)}`
  return Response.json({ url }, { status: 201 })
}

export async function GET(req: Request): Promise<Response> {
  const ctx = await resolveAuth(req)
  if (!ctx) return new Response("Unauthorized", { status: 401 })

  const { searchParams } = new URL(req.url)
  const key = searchParams.get("key")
  if (!key) {
    return Response.json({ error: "Missing key parameter" }, { status: 400 })
  }

  const signedUrl = await storage.getSignedDownloadUrl(key, 3600)
  return Response.redirect(signedUrl, 302)
}

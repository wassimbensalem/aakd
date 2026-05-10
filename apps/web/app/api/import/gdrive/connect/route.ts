import crypto from "node:crypto"
import { resolveAuth } from "@/lib/auth/middleware"
import { hasRole } from "@/lib/auth/roles"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"

const STATE_COOKIE = "gdrive_oauth_state"
const SCOPE = "https://www.googleapis.com/auth/drive.readonly"

function appBase(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "")
}

function clearStateCookie(): string {
  return `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`
}

export async function GET(req: Request) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return Response.json({ error: "google_drive_not_configured" }, { status: 503 })
  }

  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  if (!hasRole(ctx.role, "admin")) {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  const state = crypto.randomBytes(16).toString("hex")
  const redirectUri = `${appBase()}/api/import/gdrive/callback`

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  })
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

  const cookie = [
    `${STATE_COOKIE}=${state}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=600",
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ")

  return new Response(null, {
    status: 302,
    headers: { Location: authUrl, "Set-Cookie": cookie },
  })
}

export async function DELETE(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  if (!hasRole(ctx.role, "admin")) {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  return requestContext.run(ctx, async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const integrationModel = (prisma as any).googleDriveIntegration
    if (!integrationModel) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    const existing = await integrationModel.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { id: true },
    })
    if (!existing) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    await integrationModel.delete({ where: { organizationId: ctx.organizationId } })

    return new Response(null, {
      status: 204,
      headers: { "Set-Cookie": clearStateCookie() },
    })
  })
}

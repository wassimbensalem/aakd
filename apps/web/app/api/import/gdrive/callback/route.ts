import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { encrypt } from "@/lib/notifications/crypto"

const STATE_COOKIE = "gdrive_oauth_state"

function appBase(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "")
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie")
  if (!header) return null
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    if (part.slice(0, eq) === name) return part.slice(eq + 1)
  }
  return null
}

function clearStateCookie(): string {
  return `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`
}

function settingsRedirect(query: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${appBase()}/settings/import?tab=gdrive&${query}`,
      "Set-Cookie": clearStateCookie(),
    },
  })
}

export async function GET(req: Request) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return settingsRedirect(`error=${encodeURIComponent("not_configured")}`)
  }

  const ctx = await resolveAuth(req)
  if (!ctx) {
    return settingsRedirect(`error=${encodeURIComponent("unauthenticated")}`)
  }

  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  if (!code || !state) {
    return settingsRedirect(`error=${encodeURIComponent("missing_params")}`)
  }

  const cookieState = readCookie(req, STATE_COOKIE)
  if (!cookieState || cookieState !== state) {
    return settingsRedirect(`error=${encodeURIComponent("state_mismatch")}`)
  }

  const redirectUri = `${appBase()}/api/import/gdrive/callback`

  let tokenResponse: {
    access_token: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
  }
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    })
    if (!tokenRes.ok) {
      const text = await tokenRes.text()
      console.error("[gdrive.callback] token exchange failed:", tokenRes.status, text)
      return settingsRedirect(`error=${encodeURIComponent("exchange_failed")}`)
    }
    tokenResponse = await tokenRes.json()
  } catch (err) {
    console.error("[gdrive.callback] token exchange threw:", err)
    return settingsRedirect(`error=${encodeURIComponent("exchange_failed")}`)
  }

  const accessToken = tokenResponse.access_token
  const refreshToken = tokenResponse.refresh_token
  if (!accessToken || !refreshToken) {
    // prompt=consent should always return a refresh token; if it doesn't,
    // something is off (the user previously consented and Google is reusing
    // the prior token). Fail cleanly so the user can retry.
    return settingsRedirect(`error=${encodeURIComponent("missing_refresh_token")}`)
  }

  const tokenExpiresAt = tokenResponse.expires_in
    ? new Date(Date.now() + tokenResponse.expires_in * 1000)
    : null

  return requestContext.run(ctx, async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const integrationModel = prisma.googleDriveIntegration
    await integrationModel.upsert({
      where: { organizationId: ctx.organizationId },
      create: {
        organizationId: ctx.organizationId,
        accessToken: encrypt(accessToken),
        refreshToken: encrypt(refreshToken),
        tokenExpiresAt,
        connectedById: ctx.userId,
      },
      update: {
        accessToken: encrypt(accessToken),
        refreshToken: encrypt(refreshToken),
        tokenExpiresAt,
        connectedById: ctx.userId,
      },
    })

    return settingsRedirect("connected=true")
  })
}

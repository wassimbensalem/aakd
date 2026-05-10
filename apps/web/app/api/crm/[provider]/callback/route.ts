import { resolveAuth } from "@/lib/auth/middleware"
import { hasRole } from "@/lib/auth/roles"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { getCrmProvider } from "@/lib/crm"
import { encryptToken } from "@/lib/crm/crypto"
import {
  getRedirectUri,
  getWebhookUrl,
  normalizeProvider,
} from "@/lib/crm/route-helpers"

const STATE_COOKIE = "crm_oauth_state"

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

function appBase(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "")
}

function settingsRedirect(provider: string, query: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${appBase()}/settings/integrations?${query}`,
      "Set-Cookie": clearStateCookie(),
    },
  })
}

export async function GET(req: Request, { params }: { params: { provider: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const provider = normalizeProvider(params.provider)
  if (!provider) return Response.json({ error: "invalid_provider" }, { status: 400 })

  if (!hasRole(ctx.role, "legal")) {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  if (!code || !state) {
    return settingsRedirect(provider, `error=${encodeURIComponent("missing_params")}`)
  }

  const cookieState = readCookie(req, STATE_COOKIE)
  if (!cookieState || cookieState !== state) {
    return settingsRedirect(provider, `error=${encodeURIComponent("state_mismatch")}`)
  }

  const redirectUri = getRedirectUri(provider)

  let tokenSet
  try {
    tokenSet = await getCrmProvider(provider).exchangeCode(code, redirectUri)
  } catch (err) {
    console.error(`[crm.callback] ${provider} exchangeCode failed:`, err)
    return settingsRedirect(provider, `error=${encodeURIComponent("exchange_failed")}`)
  }

  return requestContext.run(ctx, async () => {
    // Store null when no refresh token was returned. Encrypting "" produces
    // a non-empty ciphertext that ensureFreshToken would later try to decrypt
    // and refresh with — which the provider rejects with 4xx.
    const encryptedRefreshToken = tokenSet.refreshToken
      ? encryptToken(tokenSet.refreshToken)
      : null

    const integration = await prisma.crmIntegration.upsert({
      where: { organizationId_provider: { organizationId: ctx.organizationId, provider } },
      create: {
        organizationId: ctx.organizationId,
        provider,
        accessToken: encryptToken(tokenSet.accessToken),
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt: tokenSet.expiresAt ?? null,
        instanceUrl: tokenSet.instanceUrl ?? null,
        portalId: tokenSet.portalId ?? null,
        connectedById: ctx.userId,
      },
      update: {
        accessToken: encryptToken(tokenSet.accessToken),
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt: tokenSet.expiresAt ?? null,
        instanceUrl: tokenSet.instanceUrl ?? null,
        portalId: tokenSet.portalId ?? null,
        connectedById: ctx.userId,
      },
    })

    if (provider === "HUBSPOT" || provider === "PIPEDRIVE") {
      try {
        const subscriptionId = await getCrmProvider(provider).registerWebhook(
          integration,
          getWebhookUrl(provider),
        )
        if (subscriptionId) {
          console.log(`[crm.callback] Registered ${provider} webhook ${subscriptionId}`)
        }
      } catch (err) {
        // Webhook registration is best-effort — the integration is still usable
        // for manual sync and (for Salesforce) polling.
        console.warn(`[crm.callback] ${provider} registerWebhook failed:`, err)
      }
    }

    return settingsRedirect(provider, `connected=${provider}`)
  })
}

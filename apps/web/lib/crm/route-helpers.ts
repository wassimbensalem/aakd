import type { CrmIntegration, CrmProvider as CrmProviderEnum } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { getCrmProvider } from "./index"
import { encryptToken } from "./crypto"

const VALID_PROVIDERS = new Set<CrmProviderEnum>(["HUBSPOT", "SALESFORCE", "PIPEDRIVE"])

export function normalizeProvider(raw: string | undefined): CrmProviderEnum | null {
  if (!raw) return null
  const upper = raw.toUpperCase() as CrmProviderEnum
  return VALID_PROVIDERS.has(upper) ? upper : null
}

export function getRedirectUri(provider: CrmProviderEnum): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:3000"
  return `${base.replace(/\/$/, "")}/api/crm/${provider.toLowerCase()}/callback`
}

export function getWebhookUrl(provider: CrmProviderEnum): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:3000"
  return `${base.replace(/\/$/, "")}/api/crm/${provider.toLowerCase()}/webhook`
}

/**
 * If the access token is expired (or about to expire in <60s), refresh it and
 * persist the new tokens. Returns the (possibly updated) integration row.
 */
export async function ensureFreshToken(
  integration: CrmIntegration,
): Promise<CrmIntegration> {
  const expiresAt = integration.tokenExpiresAt
  if (!expiresAt) return integration
  if (expiresAt.getTime() - Date.now() > 60_000) return integration
  if (!integration.refreshToken) return integration

  const provider = getCrmProvider(integration.provider)
  const fresh = await provider.refreshAccessToken(integration)

  return prisma.crmIntegration.update({
    where: { id: integration.id },
    data: {
      accessToken: encryptToken(fresh.accessToken),
      refreshToken: fresh.refreshToken
        ? encryptToken(fresh.refreshToken)
        : integration.refreshToken,
      tokenExpiresAt: fresh.expiresAt ?? integration.tokenExpiresAt,
      instanceUrl: fresh.instanceUrl ?? integration.instanceUrl,
      portalId: fresh.portalId ?? integration.portalId,
    },
  })
}

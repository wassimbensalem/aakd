import crypto from "node:crypto"
import type { CrmIntegration } from "@prisma/client"
import { decryptToken } from "./crypto"
import type { CrmProvider, DealEvent, DealSummary, TokenSet } from "./provider"

const AUTHORIZE_URL = "https://app.hubspot.com/oauth/authorize"
const TOKEN_URL = "https://api.hubapi.com/oauth/v1/token"
const API_BASE = "https://api.hubapi.com"
const SCOPES = "crm.objects.deals.read crm.objects.deals.write oauth"

interface HubSpotTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  hub_id?: number
}

interface HubSpotDealProperties {
  dealname?: string
  dealstage?: string
  amount?: string | null
  currency?: string | null
}

interface HubSpotDealObject {
  id: string
  properties: HubSpotDealProperties
}

interface HubSpotSearchResponse {
  total: number
  results: HubSpotDealObject[]
}

interface HubSpotAssociation {
  id: string
}

interface HubSpotAssociationsResponse {
  results: HubSpotAssociation[]
}

interface HubSpotCompanyResponse {
  id: string
  properties: { name?: string }
}

interface HubSpotWebhookEvent {
  subscriptionType?: string
  propertyName?: string
  propertyValue?: string
  objectId?: number | string
  occurredAt?: number
}

function clientCredentials() {
  const clientId = process.env.HUBSPOT_CLIENT_ID
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET are required")
  }
  return { clientId, clientSecret }
}

function getAccessToken(integration: CrmIntegration): string {
  return decryptToken(integration.accessToken)
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`HubSpot ${init.method ?? "GET"} ${url} failed: ${res.status} ${body}`)
  }
  return (await res.json()) as T
}

async function fetchCompanyName(
  integration: CrmIntegration,
  dealId: string
): Promise<string | null> {
  try {
    const associations = await fetchJson<HubSpotAssociationsResponse>(
      `${API_BASE}/crm/v3/objects/deals/${dealId}/associations/companies`,
      { headers: { Authorization: `Bearer ${getAccessToken(integration)}` } }
    )
    const companyId = associations.results[0]?.id
    if (!companyId) return null
    const company = await fetchJson<HubSpotCompanyResponse>(
      `${API_BASE}/crm/v3/objects/companies/${companyId}?properties=name`,
      { headers: { Authorization: `Bearer ${getAccessToken(integration)}` } }
    )
    return company.properties.name ?? null
  } catch {
    return null
  }
}

function dealToSummary(
  deal: HubSpotDealObject,
  portalId: string | null,
  counterpartyName: string | null
): DealSummary {
  const props = deal.properties
  const amountRaw = props.amount
  const value = amountRaw !== undefined && amountRaw !== null && amountRaw !== ""
    ? Number(amountRaw)
    : null
  return {
    id: deal.id,
    name: props.dealname ?? "(untitled deal)",
    stage: props.dealstage ?? "",
    value: Number.isFinite(value as number) ? (value as number) : null,
    currency: props.currency ?? null,
    counterpartyName,
    url: portalId ? `https://app.hubspot.com/contacts/${portalId}/deal/${deal.id}` : null,
  }
}

export class HubSpotProvider implements CrmProvider {
  authorizationUrl(state: string, redirectUri: string): string {
    const { clientId } = clientCredentials()
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
    })
    return `${AUTHORIZE_URL}?${params.toString()}`
  }

  async exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
    const { clientId, clientSecret } = clientCredentials()
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    })
    const data = await fetchJson<HubSpotTokenResponse>(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    })
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
      portalId: data.hub_id !== undefined ? String(data.hub_id) : undefined,
    }
  }

  async refreshAccessToken(integration: CrmIntegration): Promise<TokenSet> {
    if (!integration.refreshToken) {
      throw new Error("HubSpot integration has no refresh token")
    }
    const { clientId, clientSecret } = clientCredentials()
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decryptToken(integration.refreshToken),
    })
    const data = await fetchJson<HubSpotTokenResponse>(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    })
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
      portalId: data.hub_id !== undefined ? String(data.hub_id) : integration.portalId ?? undefined,
    }
  }

  async searchDeals(integration: CrmIntegration, query: string): Promise<DealSummary[]> {
    const data = await fetchJson<HubSpotSearchResponse>(
      `${API_BASE}/crm/v3/objects/deals/search`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getAccessToken(integration)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filterGroups: query
            ? [
                {
                  filters: [
                    { propertyName: "dealname", operator: "CONTAINS_TOKEN", value: query },
                  ],
                },
              ]
            : [],
          properties: ["dealname", "dealstage", "amount", "currency"],
          limit: 20,
        }),
      }
    )
    return data.results.map((deal) => dealToSummary(deal, integration.portalId, null))
  }

  async getDeal(integration: CrmIntegration, dealId: string): Promise<DealSummary | null> {
    try {
      const deal = await fetchJson<HubSpotDealObject>(
        `${API_BASE}/crm/v3/objects/deals/${dealId}?properties=dealname,dealstage,amount,currency`,
        { headers: { Authorization: `Bearer ${getAccessToken(integration)}` } }
      )
      const counterpartyName = await fetchCompanyName(integration, dealId)
      return dealToSummary(deal, integration.portalId, counterpartyName)
    } catch {
      return null
    }
  }

  async updateDealStage(
    integration: CrmIntegration,
    dealId: string,
    stageName: string
  ): Promise<void> {
    await fetchJson<HubSpotDealObject>(`${API_BASE}/crm/v3/objects/deals/${dealId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${getAccessToken(integration)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties: { dealstage: stageName } }),
    })
  }

  async registerWebhook(integration: CrmIntegration, targetUrl: string): Promise<string> {
    const appId = process.env.HUBSPOT_APP_ID
    if (!appId) throw new Error("HUBSPOT_APP_ID is required to register webhooks")
    const data = await fetchJson<{ id: number | string }>(
      `${API_BASE}/webhooks/v3/${appId}/subscriptions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getAccessToken(integration)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventType: "deal.propertyChange",
          propertyName: "dealstage",
          active: true,
          targetUrl,
        }),
      }
    )
    return String(data.id)
  }

  async parseWebhookEvent(
    req: Request,
    integration: CrmIntegration
  ): Promise<DealEvent | null> {
    const { clientSecret } = clientCredentials()
    const signature = req.headers.get("x-hubspot-signature-v3")
    const timestamp = req.headers.get("x-hubspot-request-timestamp")
    if (!signature || !timestamp) return null

    const rawBody = await req.text()
    const requestUri = req.url
    const message = `${clientSecret}${requestUri}${rawBody}${timestamp}`
    const expected = crypto.createHmac("sha256", clientSecret).update(message).digest("base64")

    let signatureBuf: Buffer
    let expectedBuf: Buffer
    try {
      signatureBuf = Buffer.from(signature, "base64")
      expectedBuf = Buffer.from(expected, "base64")
    } catch {
      return null
    }
    if (
      signatureBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(signatureBuf, expectedBuf)
    ) {
      return null
    }

    let events: HubSpotWebhookEvent[]
    try {
      const parsed = JSON.parse(rawBody)
      events = Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      return null
    }

    const stageEvent = events.find(
      (e) => e.subscriptionType === "deal.propertyChange" && e.propertyName === "dealstage"
    )
    if (!stageEvent || stageEvent.objectId === undefined) return null

    const dealId = String(stageEvent.objectId)
    const summary = await this.getDeal(integration, dealId)
    if (!summary) {
      return {
        dealId,
        dealName: "",
        stage: stageEvent.propertyValue ?? "",
        value: null,
        currency: null,
        counterpartyName: null,
        eventType: "stage_changed",
      }
    }
    return {
      dealId: summary.id,
      dealName: summary.name,
      stage: stageEvent.propertyValue ?? summary.stage,
      value: summary.value,
      currency: summary.currency,
      counterpartyName: summary.counterpartyName,
      eventType: "stage_changed",
    }
  }
}

import crypto from "node:crypto"
import type { CrmIntegration } from "@prisma/client"
import { decryptToken } from "./crypto"
import type { CrmProvider, DealEvent, DealSummary, TokenSet } from "./provider"

const AUTHORIZE_URL = "https://oauth.pipedrive.com/oauth/authorize"
const TOKEN_URL = "https://oauth.pipedrive.com/oauth/token"
const API_BASE = "https://api.pipedrive.com"
const SCOPES = "deals:read deals:write"

interface PipedriveTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  api_domain?: string
}

interface PipedriveDeal {
  id: number | string
  title?: string
  stage_id?: number | null
  value?: number | null
  currency?: string | null
  org_name?: string | null
}

interface PipedriveSearchItem {
  result_score?: number
  item?: {
    id: number | string
    title?: string
    stage?: { id?: number; name?: string } | null
    value?: number | null
    currency?: string | null
    organization?: { name?: string } | null
  }
}

interface PipedriveResponse<T> {
  success: boolean
  data: T
  error?: string
}

interface PipedriveStage {
  id: number
  name: string
  pipeline_id?: number
}

function clientCredentials() {
  const clientId = process.env.PIPEDRIVE_CLIENT_ID
  const clientSecret = process.env.PIPEDRIVE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("PIPEDRIVE_CLIENT_ID and PIPEDRIVE_CLIENT_SECRET are required")
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
    throw new Error(`Pipedrive ${init.method ?? "GET"} ${url} failed: ${res.status} ${body}`)
  }
  return (await res.json()) as T
}

async function lookupStageName(
  integration: CrmIntegration,
  stageId: number | null | undefined
): Promise<string> {
  if (stageId === null || stageId === undefined) return ""
  try {
    const data = await fetchJson<PipedriveResponse<PipedriveStage>>(
      `${API_BASE}/v1/stages/${stageId}`,
      { headers: { Authorization: `Bearer ${getAccessToken(integration)}` } }
    )
    return data.data?.name ?? String(stageId)
  } catch {
    return String(stageId)
  }
}

export class PipedriveProvider implements CrmProvider {
  authorizationUrl(state: string, redirectUri: string): string {
    const { clientId } = clientCredentials()
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: SCOPES,
    })
    return `${AUTHORIZE_URL}?${params.toString()}`
  }

  async exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
    const { clientId, clientSecret } = clientCredentials()
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    })
    const data = await fetchJson<PipedriveTokenResponse>(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: body.toString(),
    })
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
    }
  }

  async refreshAccessToken(integration: CrmIntegration): Promise<TokenSet> {
    if (!integration.refreshToken) {
      throw new Error("Pipedrive integration has no refresh token")
    }
    const { clientId, clientSecret } = clientCredentials()
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: decryptToken(integration.refreshToken),
    })
    const data = await fetchJson<PipedriveTokenResponse>(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: body.toString(),
    })
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
    }
  }

  async searchDeals(integration: CrmIntegration, query: string): Promise<DealSummary[]> {
    if (!query) return []
    const params = new URLSearchParams({
      term: query,
      fields: "title",
      limit: "20",
    })
    const data = await fetchJson<PipedriveResponse<{ items?: PipedriveSearchItem[] }>>(
      `${API_BASE}/v1/deals/search?${params.toString()}`,
      { headers: { Authorization: `Bearer ${getAccessToken(integration)}` } }
    )
    const items = data.data?.items ?? []
    return items
      .map((entry) => entry.item)
      .filter((item): item is NonNullable<PipedriveSearchItem["item"]> => Boolean(item))
      .map((item) => ({
        id: String(item.id),
        name: item.title ?? "(untitled deal)",
        stage: item.stage?.name ?? "",
        value: item.value ?? null,
        currency: item.currency ?? null,
        counterpartyName: item.organization?.name ?? null,
        url: `https://app.pipedrive.com/deal/${item.id}`,
      }))
  }

  async getDeal(integration: CrmIntegration, dealId: string): Promise<DealSummary | null> {
    try {
      const data = await fetchJson<PipedriveResponse<PipedriveDeal>>(
        `${API_BASE}/v1/deals/${encodeURIComponent(dealId)}`,
        { headers: { Authorization: `Bearer ${getAccessToken(integration)}` } }
      )
      const deal = data.data
      if (!deal) return null
      const stageName = await lookupStageName(integration, deal.stage_id ?? null)
      return {
        id: String(deal.id),
        name: deal.title ?? "(untitled deal)",
        stage: stageName,
        value: deal.value ?? null,
        currency: deal.currency ?? null,
        counterpartyName: deal.org_name ?? null,
        url: `https://app.pipedrive.com/deal/${deal.id}`,
      }
    } catch {
      return null
    }
  }

  async updateDealStage(
    integration: CrmIntegration,
    dealId: string,
    stageName: string
  ): Promise<void> {
    // Pipedrive needs a stage ID, not a name. List stages and find the one matching `stageName`.
    const stages = await fetchJson<PipedriveResponse<PipedriveStage[]>>(
      `${API_BASE}/v1/stages`,
      { headers: { Authorization: `Bearer ${getAccessToken(integration)}` } }
    )
    const match = (stages.data ?? []).find(
      (s) => s.name.toLowerCase() === stageName.toLowerCase()
    )
    if (!match) {
      throw new Error(`Pipedrive stage "${stageName}" not found in connected account`)
    }

    const url = `${API_BASE}/v1/deals/${encodeURIComponent(dealId)}`
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${getAccessToken(integration)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ stage_id: match.id }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`Pipedrive PUT ${url} failed: ${res.status} ${body}`)
    }
  }

  async registerWebhook(integration: CrmIntegration, targetUrl: string): Promise<string> {
    const data = await fetchJson<PipedriveResponse<{ id: number | string }>>(
      `${API_BASE}/v1/webhooks`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getAccessToken(integration)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subscription_url: targetUrl,
          event_action: "changed",
          event_object: "deal",
        }),
      }
    )
    return String(data.data?.id ?? "")
  }

  async parseWebhookEvent(
    req: Request,
    _integration: CrmIntegration
  ): Promise<DealEvent | null> {
    const { clientSecret } = clientCredentials()
    const signature = req.headers.get("x-pipedrive-signature")
    if (!signature) return null

    const rawBody = await req.text()
    const expected = crypto
      .createHmac("sha256", clientSecret)
      .update(rawBody)
      .digest("hex")

    let signatureBuf: Buffer
    let expectedBuf: Buffer
    try {
      signatureBuf = Buffer.from(signature, "hex")
      expectedBuf = Buffer.from(expected, "hex")
    } catch {
      return null
    }
    if (
      signatureBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(signatureBuf, expectedBuf)
    ) {
      return null
    }

    let parsed: {
      event?: string
      current?: PipedriveDeal
      previous?: PipedriveDeal
    }
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      return null
    }

    const current = parsed.current
    const previous = parsed.previous
    if (!current || current.id === undefined) return null
    if (!previous || current.stage_id === previous.stage_id) return null

    return {
      dealId: String(current.id),
      dealName: current.title ?? "",
      stage: current.stage_id !== null && current.stage_id !== undefined
        ? String(current.stage_id)
        : "",
      value: current.value ?? null,
      currency: current.currency ?? null,
      counterpartyName: current.org_name ?? null,
      eventType: "stage_changed",
    }
  }
}

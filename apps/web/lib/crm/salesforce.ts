import type { CrmIntegration } from "@prisma/client"
import { decryptToken } from "./crypto"
import type { CrmProvider, DealEvent, DealSummary, TokenSet } from "./provider"

const AUTHORIZE_URL = "https://login.salesforce.com/services/oauth2/authorize"
const TOKEN_URL = "https://login.salesforce.com/services/oauth2/token"
const API_VERSION = "v60.0"
const SCOPES = "api refresh_token"

interface SalesforceTokenResponse {
  access_token: string
  refresh_token?: string
  instance_url?: string
  issued_at?: string
}

interface SalesforceOpportunity {
  Id: string
  Name?: string
  StageName?: string
  Amount?: number | null
  CurrencyIsoCode?: string | null
  Account?: { Name?: string } | null
}

interface SalesforceQueryResponse {
  totalSize: number
  done: boolean
  records: SalesforceOpportunity[]
}

function clientCredentials() {
  const clientId = process.env.SALESFORCE_CLIENT_ID
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET are required")
  }
  return { clientId, clientSecret }
}

function requireInstanceUrl(integration: CrmIntegration): string {
  if (!integration.instanceUrl) {
    throw new Error("Salesforce integration missing instanceUrl")
  }
  return integration.instanceUrl
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Salesforce ${init.method ?? "GET"} ${url} failed: ${res.status} ${body}`)
  }
  return (await res.json()) as T
}

function escapeSoql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function opportunityToSummary(
  opp: SalesforceOpportunity,
  instanceUrl: string
): DealSummary {
  return {
    id: opp.Id,
    name: opp.Name ?? "(untitled opportunity)",
    stage: opp.StageName ?? "",
    value: opp.Amount ?? null,
    currency: opp.CurrencyIsoCode ?? null,
    counterpartyName: opp.Account?.Name ?? null,
    url: `${instanceUrl}/${opp.Id}`,
  }
}

export class SalesforceProvider implements CrmProvider {
  authorizationUrl(state: string, redirectUri: string): string {
    const { clientId } = clientCredentials()
    const params = new URLSearchParams({
      response_type: "code",
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
    const data = await fetchJson<SalesforceTokenResponse>(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    })
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      instanceUrl: data.instance_url,
    }
  }

  async refreshAccessToken(integration: CrmIntegration): Promise<TokenSet> {
    if (!integration.refreshToken) {
      throw new Error("Salesforce integration has no refresh token")
    }
    const instanceUrl = requireInstanceUrl(integration)
    const { clientId, clientSecret } = clientCredentials()
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decryptToken(integration.refreshToken),
    })
    const data = await fetchJson<SalesforceTokenResponse>(
      `${instanceUrl}/services/oauth2/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }
    )
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? decryptToken(integration.refreshToken),
      instanceUrl: data.instance_url ?? instanceUrl,
    }
  }

  async searchDeals(integration: CrmIntegration, query: string): Promise<DealSummary[]> {
    const instanceUrl = requireInstanceUrl(integration)
    const accessToken = decryptToken(integration.accessToken)
    const safe = escapeSoql(query)
    const soql = `SELECT Id, Name, StageName, Amount, CurrencyIsoCode, Account.Name FROM Opportunity WHERE Name LIKE '%${safe}%' LIMIT 20`
    const data = await fetchJson<SalesforceQueryResponse>(
      `${instanceUrl}/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    return data.records.map((opp) => opportunityToSummary(opp, instanceUrl))
  }

  async getDeal(integration: CrmIntegration, dealId: string): Promise<DealSummary | null> {
    const instanceUrl = requireInstanceUrl(integration)
    const accessToken = decryptToken(integration.accessToken)
    const safe = escapeSoql(dealId)
    const soql = `SELECT Id, Name, StageName, Amount, CurrencyIsoCode, Account.Name FROM Opportunity WHERE Id = '${safe}' LIMIT 1`
    try {
      const data = await fetchJson<SalesforceQueryResponse>(
        `${instanceUrl}/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const record = data.records[0]
      if (!record) return null
      return opportunityToSummary(record, instanceUrl)
    } catch {
      return null
    }
  }

  async updateDealStage(
    integration: CrmIntegration,
    dealId: string,
    stageName: string
  ): Promise<void> {
    const instanceUrl = requireInstanceUrl(integration)
    const accessToken = decryptToken(integration.accessToken)
    const url = `${instanceUrl}/services/data/${API_VERSION}/sobjects/Opportunity/${encodeURIComponent(dealId)}`
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ StageName: stageName }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`Salesforce PATCH ${url} failed: ${res.status} ${body}`)
    }
  }

  async registerWebhook(_integration: CrmIntegration, _targetUrl: string): Promise<string> {
    // Salesforce uses polling in v1 — no webhook subscription registered.
    return ""
  }

  async parseWebhookEvent(
    _req: Request,
    _integration: CrmIntegration
  ): Promise<DealEvent | null> {
    // Salesforce uses polling; no webhook receiver.
    return null
  }
}

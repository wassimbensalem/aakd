import type { CrmIntegration } from "@prisma/client"

export interface DealSummary {
  id: string
  name: string
  stage: string
  value: number | null
  currency: string | null
  counterpartyName: string | null
  url: string | null
}

export interface TokenSet {
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  instanceUrl?: string
  portalId?: string
}

export interface DealEvent {
  dealId: string
  dealName: string
  stage: string
  value: number | null
  currency: string | null
  counterpartyName: string | null
  eventType: "created" | "stage_changed" | "updated"
}

export interface CrmProvider {
  /** Exchange auth code for tokens. Returns accessToken, refreshToken?, expiresAt?, instanceUrl? */
  exchangeCode(code: string, redirectUri: string): Promise<TokenSet>

  /** Builds the provider's OAuth authorization URL. */
  authorizationUrl(state: string, redirectUri: string): string

  /** Refresh access token using stored refreshToken. Returns new TokenSet. */
  refreshAccessToken(integration: CrmIntegration): Promise<TokenSet>

  /** Search/list deals matching a query string. Max 20 results. */
  searchDeals(integration: CrmIntegration, query: string): Promise<DealSummary[]>

  /** Fetch a single deal by its external ID. */
  getDeal(integration: CrmIntegration, dealId: string): Promise<DealSummary | null>

  /** Update the deal's stage. stageName is the human-readable stage (we map per-provider). */
  updateDealStage(integration: CrmIntegration, dealId: string, stageName: string): Promise<void>

  /** Register a webhook subscription for deal stage changes. Returns the subscription ID. */
  registerWebhook(integration: CrmIntegration, targetUrl: string): Promise<string>

  /** Verify an incoming webhook request is legitimate. Returns parsed deal event or null. */
  parseWebhookEvent(req: Request, integration: CrmIntegration): Promise<DealEvent | null>
}

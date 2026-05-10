import { HubSpotProvider } from "./hubspot"
import { SalesforceProvider } from "./salesforce"
import { PipedriveProvider } from "./pipedrive"
import type { CrmProvider as ICrmProvider } from "./provider"

const providers: Record<string, ICrmProvider> = {
  HUBSPOT: new HubSpotProvider(),
  SALESFORCE: new SalesforceProvider(),
  PIPEDRIVE: new PipedriveProvider(),
}

export function getCrmProvider(provider: string): ICrmProvider {
  const p = providers[provider]
  if (!p) throw new Error(`Unknown CRM provider: ${provider}`)
  return p
}

export type { CrmProvider as ICrmProvider, DealSummary, DealEvent, TokenSet } from "./provider"

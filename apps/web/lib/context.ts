import { AsyncLocalStorage } from "async_hooks"

export interface RequestContext {
  userId: string
  organizationId: string
  role: string
  scopes?: string[]
  source: "session" | "api_key"
}

export const requestContext = new AsyncLocalStorage<RequestContext>()

export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore()
}

import { PostHog } from "posthog-node"

let _client: PostHog | null = null

export function getPostHogServer(): PostHog | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST
  if (!key) return null
  if (!_client) {
    _client = new PostHog(key, {
      host: host ?? "https://eu.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
    })
  }
  return _client
}

export function captureServerEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
) {
  const ph = getPostHogServer()
  if (!ph) return
  ph.capture({ distinctId, event, properties: properties ?? {} })
}

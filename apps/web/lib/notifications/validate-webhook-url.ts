import dns from "dns/promises"

// Patterns matching RFC-1918, loopback, and link-local ranges
const BLOCKED_IP_RANGES = [
  /^127\./,                          // loopback IPv4
  /^10\./,                           // RFC-1918
  /^172\.(1[6-9]|2[0-9]|3[01])\./,  // RFC-1918
  /^192\.168\./,                     // RFC-1918
  /^169\.254\./,                     // link-local (AWS IMDS)
  /^0\./,                            // reserved
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // CGNAT RFC-6598
  /^::1$/,                           // IPv6 loopback
  /^fc00:/i,                         // IPv6 unique local
  /^fd[0-9a-f]{2}:/i,               // IPv6 unique local
  /^fe80:/i,                         // IPv6 link-local
]

const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0", "::1", "ip6-localhost", "ip6-loopback"])

/**
 * Validates a webhook URL to prevent SSRF attacks.
 *
 * Rejects:
 * - Non-http/https protocols
 * - localhost and other loopback hostnames
 * - RFC-1918 private IP ranges
 * - Link-local IPs (AWS IMDS, etc.)
 *
 * Throws an Error with a user-friendly message when the URL is rejected.
 */
export async function validateWebhookUrl(urlString: string): Promise<void> {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    throw new Error("Invalid URL format")
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http and https URLs are allowed")
  }

  const hostname = url.hostname.toLowerCase()

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error("Private or internal URLs are not allowed")
  }

  // Resolve the hostname to IPs and block private ranges.
  // DNS resolution failure is non-fatal — we let the delivery attempt fail
  // at dispatch time rather than blocking registration on transient DNS errors.
  try {
    const v4Addresses = await dns.resolve4(hostname).catch(() => [] as string[])
    const v6Addresses = await dns.resolve6(hostname).catch(() => [] as string[])
    const allIPs = [...v4Addresses, ...v6Addresses]

    for (const ip of allIPs) {
      if (BLOCKED_IP_RANGES.some((re) => re.test(ip))) {
        throw new Error("Webhook URL resolves to a private or internal IP range")
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // Only re-throw our own validation errors; swallow DNS errors.
    if (
      message.includes("private") ||
      message.includes("internal") ||
      message.includes("not allowed") ||
      message.includes("loopback")
    ) {
      throw err
    }
    // DNS lookup failed — allow registration; delivery will fail safely.
  }
}

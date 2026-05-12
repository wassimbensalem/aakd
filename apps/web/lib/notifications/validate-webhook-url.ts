import dns from "dns/promises"
import net from "net"

// Patterns matching RFC-1918, loopback, link-local, and other reserved ranges
const BLOCKED_IP_RANGES = [
  /^127\./,                          // loopback IPv4
  /^10\./,                           // RFC-1918
  /^172\.(1[6-9]|2[0-9]|3[01])\./,  // RFC-1918
  /^192\.168\./,                     // RFC-1918
  /^169\.254\./,                     // link-local (AWS IMDS / GCP metadata)
  /^0\./,                            // reserved / "this" network
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // CGNAT RFC-6598
  /^::1$/,                           // IPv6 loopback
  /^fc00:/i,                         // IPv6 unique local
  /^fd[0-9a-f]{2}:/i,               // IPv6 unique local
  /^fe80:/i,                         // IPv6 link-local
  /^0\.0\.0\.0$/,                    // unspecified
]

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "0.0.0.0",
  "::1",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",        // GCP metadata service
])

function isBlockedIP(ip: string): boolean {
  return BLOCKED_IP_RANGES.some((re) => re.test(ip))
}

/**
 * Validates a webhook URL to prevent SSRF attacks.
 *
 * Rejects:
 * - Non-http/https protocols
 * - localhost and other loopback hostnames
 * - RFC-1918 private IP ranges
 * - Link-local IPs (AWS IMDS, GCP metadata, etc.)
 * - Literal private IP addresses in the URL (bypasses DNS-only checks)
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

  // If the hostname is a literal IP address, check it directly.
  // dns.resolve4/6 is designed for hostnames → it returns ENOTFOUND for
  // literal IPs, which the catch block would swallow, leaving the IP unchecked.
  if (net.isIP(hostname) !== 0) {
    if (isBlockedIP(hostname)) {
      throw new Error("Private or internal IP addresses are not allowed")
    }
    // Literal public IP — nothing else to check.
    return
  }

  // Hostname case: resolve to IPs and verify none are private.
  // DNS failure is non-fatal — we let delivery fail safely rather than
  // blocking registration on transient DNS errors.
  try {
    const v4Addresses = await dns.resolve4(hostname).catch(() => [] as string[])
    const v6Addresses = await dns.resolve6(hostname).catch(() => [] as string[])
    const allIPs = [...v4Addresses, ...v6Addresses]

    for (const ip of allIPs) {
      if (isBlockedIP(ip)) {
        throw new Error("Webhook URL resolves to a private or internal IP range")
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // Only re-throw our own validation errors; swallow DNS errors.
    if (
      message.includes("private") ||
      message.includes("internal") ||
      message.includes("not allowed")
    ) {
      throw err
    }
    // DNS lookup failed — allow registration; delivery will fail safely.
  }
}

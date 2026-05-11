/**
 * Thin wrapper around the DocuSeal REST API.
 * All functions return null (and log a warning) when DOCUSEAL_API_KEY is not set.
 * Never import any third-party DocuSeal SDK — use fetch only.
 */

const BASE = process.env.DOCUSEAL_API_URL || process.env.DOCUSEAL_BASE_URL || "https://api.docuseal.com"
const KEY = process.env.DOCUSEAL_API_KEY

/**
 * SSRF guard. DocuSeal returns signed-PDF URLs in its webhooks and submission
 * responses; we never fetch a URL we received from an external party without
 * confirming its origin matches our configured DocuSeal endpoint. This blocks
 * an attacker who can forge or replay a webhook from pointing us at an
 * internal address (e.g. cloud metadata service).
 */
export function isAllowedDocuSealUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false

  let baseHost: string
  try {
    baseHost = new URL(BASE).hostname
  } catch {
    return false
  }

  return parsed.hostname === baseHost
}

function authHeaders(): Record<string, string> {
  return {
    "X-Auth-Token": KEY ?? "",
  }
}

function warnMissing(): null {
  console.warn("[docuseal] DOCUSEAL_API_KEY is not configured — skipping DocuSeal call")
  return null
}

// ─── createTemplate ───────────────────────────────────────────────────────────

/**
 * Upload a PDF buffer to DocuSeal as a template.
 * DocuSeal Cloud expects JSON + base64-encoded file at POST /templates/pdf.
 * (multipart/form-data is rejected with a 422 JSON parse error on Cloud.)
 * Returns { id: templateId } or null if unconfigured / on error.
 */
export async function createTemplate(
  name: string,
  pdfBuffer: Buffer,
): Promise<{ id: number } | null> {
  if (!KEY) return warnMissing()

  const base64File = `data:application/pdf;base64,${pdfBuffer.toString("base64")}`

  const res = await fetch(`${BASE}/templates/pdf`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      documents: [{ name: `${name}.pdf`, file: base64File }],
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    console.error(`[docuseal] createTemplate failed: ${res.status} ${text}`)
    return null
  }

  const data = await res.json()
  return { id: data.id as number }
}

// ─── createSubmission ─────────────────────────────────────────────────────────

export interface DocuSealSubmitter {
  slug: string
  embed_src: string
}

export interface DocuSealSubmission {
  id: number
  submitters: DocuSealSubmitter[]
}

/**
 * Create a submission (send for signing).
 * POST /submissions
 * Returns { id, submitters: [{ slug, embed_src }] } or null if unconfigured.
 */
export async function createSubmission(
  templateId: number,
  signers: { email: string; name: string }[],
): Promise<DocuSealSubmission | null> {
  if (!KEY) return warnMissing()

  const res = await fetch(`${BASE}/submissions`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      template_id: templateId,
      send_email: true,
      submitters: signers.map((s) => ({
        email: s.email,
        name: s.name,
        role: "First Party",
      })),
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    console.error(`[docuseal] createSubmission failed: ${res.status} ${text}`)
    return null
  }

  const data = await res.json()
  return {
    id: data.id as number,
    submitters: (data.submitters ?? []) as DocuSealSubmitter[],
  }
}

// ─── remindSubmitter ──────────────────────────────────────────────────────────

/**
 * Send a reminder email to a specific submitter.
 * POST /submitters/{slug}/remind
 */
export async function remindSubmitter(slug: string): Promise<boolean> {
  if (!KEY) return false
  const res = await fetch(`${BASE}/submitters/${slug}/remind`, {
    method: "POST",
    headers: authHeaders(),
  })
  return res.ok
}

// ─── getSubmission ────────────────────────────────────────────────────────────

export interface DocuSealSubmissionDetail {
  id: number
  status: string
  documents: { url: string }[]
}

/**
 * Get submission status — used to verify webhook payloads.
 * GET /submissions/:id
 * Returns the submission or null if unconfigured / not found.
 */
export async function getSubmission(
  submissionId: number,
): Promise<DocuSealSubmissionDetail | null> {
  if (!KEY) return warnMissing()

  const res = await fetch(`${BASE}/submissions/${submissionId}`, {
    method: "GET",
    headers: authHeaders(),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    console.error(`[docuseal] getSubmission failed: ${res.status} ${text}`)
    return null
  }

  const data = await res.json()
  return {
    id: data.id as number,
    status: data.status as string,
    documents: (data.documents ?? []) as { url: string }[],
  }
}

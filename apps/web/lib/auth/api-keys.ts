import { randomBytes, createHash } from "crypto"
import bcrypt from "bcryptjs"

export interface GeneratedApiKey {
  raw: string        // shown once to user — never stored
  keyHash: string    // bcrypt hash — stored in DB
  lookupHash: string // SHA-256 — stored in DB for fast lookup
  prefix: string     // first 20 chars — stored, shown in UI list
}

export async function generateApiKey(): Promise<GeneratedApiKey> {
  const raw = `cf_live_${randomBytes(32).toString("hex")}`
  const [keyHash, lookupHash] = await Promise.all([
    bcrypt.hash(raw, 10),
    Promise.resolve(createHash("sha256").update(raw).digest("hex")),
  ])
  return { raw, keyHash, lookupHash, prefix: raw.slice(0, 20) }
}

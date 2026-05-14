/**
 * Thin logger that strips sensitive fields in production.
 *
 * Usage:
 *   import { logger } from "@/lib/logger"
 *   logger.info("[route] message", { contractId, orgId })
 *   logger.error("[route] failed", err)
 */

const isProd = process.env.NODE_ENV === "production"

// Fields that must never appear in logs — they can contain secrets or PII
const STRIP = new Set([
  "apikey",
  "key",
  "password",
  "token",
  "secret",
  "authorization",
])

function sanitize(meta: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(meta).filter(([k]) => !STRIP.has(k.toLowerCase())),
  )
}

export const logger = {
  info(msg: string, meta?: Record<string, unknown>) {
    console.log(msg, meta ? sanitize(meta) : "")
  },
  warn(msg: string, meta?: Record<string, unknown>) {
    console.warn(msg, meta ? sanitize(meta) : "")
  },
  error(msg: string, err?: unknown, meta?: Record<string, unknown>) {
    const errMsg = err instanceof Error ? err.message : String(err ?? "")
    const safeErr = isProd
      ? { error: errMsg }
      : { error: errMsg, stack: err instanceof Error ? err.stack : undefined }
    console.error(msg, { ...safeErr, ...(meta ? sanitize(meta) : {}) })
  },
}

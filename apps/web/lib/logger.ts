/**
 * Structured logger for ClauseFlow — built on pino.
 *
 * Usage (structured object FIRST, message string SECOND — pino convention):
 *   import { logger } from "@/lib/logger"
 *   logger.info({ contractId, orgId }, "Contract fetched")
 *   logger.error({ err, contractId }, "Contract extraction failed")
 *
 * For child loggers with fixed context:
 *   import { createLogger } from "@/lib/logger"
 *   const log = createLogger({ route: "contracts", method: "POST" })
 *   log.info({ count }, "Contracts listed")
 */

import pino from "pino"
import { trace } from "@opentelemetry/api"

const isDev = process.env.NODE_ENV !== "production"

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  // Pretty-print in development, newline-delimited JSON in production
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    },
  }),
  // Redact sensitive fields from all log output — both top-level and nested
  redact: {
    paths: [
      "password",
      "token",
      "apiKey",
      "api_key",
      "secret",
      "authorization",
      "cookie",
      "keyHash",
      "lookupHash",
      "encryptedKey",
      "accessToken",
      "refreshToken",
      "*.password",
      "*.token",
      "*.apiKey",
      "*.secret",
      "*.encryptedKey",
      "*.accessToken",
      "*.refreshToken",
    ],
    censor: "[REDACTED]",
  },
})

/**
 * Child logger factory — binds fixed context fields to every log line.
 * Use this inside a route or service module to avoid repeating context.
 *
 *   const log = createLogger({ route: "contracts", method: "POST" })
 *   log.info({ contractId }, "Created")
 */
export function createLogger(context: Record<string, unknown>) {
  return logger.child(context)
}

/**
 * Returns the current OTel trace ID and span ID if a trace is active.
 * Returns empty strings when OTel is disabled or no trace is active.
 */
export function getTraceContext(): { traceId: string; spanId: string } {
  const span = trace.getActiveSpan()
  if (!span) return { traceId: "", spanId: "" }
  const ctx = span.spanContext()
  return { traceId: ctx.traceId, spanId: ctx.spanId }
}

/**
 * Request-scoped child logger — binds requestId to every log line.
 * When OTel is active, automatically includes traceId and spanId so logs can
 * be correlated with traces in Jaeger/Datadog/Tempo.
 *
 *   const log = requestLogger(ctx.requestId)
 *   log.error({ err, contractId }, "[PATCH /contracts/:id] update error")
 */
export function requestLogger(requestId: string) {
  const { traceId, spanId } = getTraceContext()
  return logger.child({ requestId, ...(traceId ? { traceId, spanId } : {}) })
}

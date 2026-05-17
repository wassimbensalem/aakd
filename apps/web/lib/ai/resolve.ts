/**
 * Resolves the effective AI config for an organization.
 *
 * Priority:
 *   1. Per-org BYOK key stored in OrgAiConfig (encrypted at rest)
 *   2. Server-level env vars (AI_PROVIDER + ANTHROPIC_API_KEY / OPENAI_API_KEY / OLLAMA_BASE_URL)
 *
 * Used by worker jobs and API routes that need to call AI providers.
 * This is the single source of truth for AI key resolution — never read
 * process.env AI keys directly in routes; call this instead.
 *
 * Per-request memoization: wrap handlers with `withAiConfigCache` to avoid
 * redundant DB round-trips when the same org config is resolved multiple times
 * within a single request (e.g. ask route calls resolveAiConfig twice).
 */

import { AsyncLocalStorage } from "node:async_hooks"
import { prisma } from "@/lib/db/client"
import { decrypt } from "@/lib/notifications/crypto"
import { logger } from "@/lib/logger"

export type AiProvider = "anthropic" | "openai" | "ollama"

export interface ResolvedAiConfig {
  provider: AiProvider | null
  apiKey: string | null
  model: string | null
  /** "org" = BYOK key from OrgAiConfig; "env" = server env var; null = not configured */
  source: "org" | "env" | null
}

// ─── Per-request cache ────────────────────────────────────────────────────────

const cache = new AsyncLocalStorage<Map<string, ResolvedAiConfig>>()

/**
 * Wrap an async handler to enable per-request memoization of resolveAiConfig.
 * Each call to resolveAiConfig within `fn` that shares the same organizationId
 * hits the DB only once per request.
 */
export function withAiConfigCache<T>(fn: () => Promise<T>): Promise<T> {
  return cache.run(new Map(), fn)
}

// ─── Internal uncached implementation ────────────────────────────────────────

async function resolveAiConfigUncached(
  organizationId: string,
): Promise<ResolvedAiConfig> {
  // 1. Try org-level BYOK key first
  try {
    const orgConfig = await prisma.orgAiConfig.findUnique({
      where: { organizationId },
      select: { provider: true, encryptedKey: true, model: true },
    })

    if (orgConfig) {
      let apiKey: string | null = null
      try {
        apiKey = decrypt(orgConfig.encryptedKey)
      } catch (err) {
        logger.error(
          { err, organizationId },
          "[resolveAiConfig] Failed to decrypt key for org",
        )
        // Fall through to env vars if decryption fails
      }

      if (apiKey) {
        return {
          provider: orgConfig.provider as AiProvider,
          apiKey,
          model: orgConfig.model ?? null,
          source: "org",
        }
      }
    }
  } catch (err) {
    logger.error(
      { err, organizationId },
      "[resolveAiConfig] DB lookup failed for org",
    )
    // Fall through to env vars
  }

  // 2. Fall back to server env vars
  const envProvider = (process.env.AI_PROVIDER?.toLowerCase() ?? null) as AiProvider | null

  if (envProvider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
      source: "env",
    }
  }

  if (envProvider === "openai" && process.env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      source: "env",
    }
  }

  if (envProvider === "ollama" && process.env.OLLAMA_BASE_URL) {
    return {
      provider: "ollama",
      apiKey: null,
      model: process.env.OLLAMA_MODEL ?? "llama3",
      source: "env",
    }
  }

  // Auto-detect when AI_PROVIDER is unset
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
      source: "env",
    }
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      source: "env",
    }
  }

  if (process.env.OLLAMA_BASE_URL) {
    return {
      provider: "ollama",
      apiKey: null,
      model: process.env.OLLAMA_MODEL ?? "llama3",
      source: "env",
    }
  }

  return { provider: null, apiKey: null, model: null, source: null }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function resolveAiConfig(
  organizationId: string,
): Promise<ResolvedAiConfig> {
  const store = cache.getStore()

  if (store) {
    const cached = store.get(organizationId)
    if (cached) return cached
  }

  const result = await resolveAiConfigUncached(organizationId)

  if (store) store.set(organizationId, result)

  return result
}

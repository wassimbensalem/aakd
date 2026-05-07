import { Queue } from "bullmq"

const connection = {
  url: process.env.REDIS_URL ?? "redis://localhost:6379",
}

// ─── Job data types ────────────────────────────────────────────────────────────

export interface ContractExtractJobData {
  contractId: string
  fileId: string
  storageKey: string
}

export interface ContractAiExtractJobData {
  contractId: string
  extractedText: string
}

export interface AlertsCheckJobData {
  triggeredAt: string
}

export interface ContractEmbedJobData {
  contractId: string
  extractedText: string
}

// ─── Queue instances ──────────────────────────────────────────────────────────

export const contractExtractQueue = new Queue<ContractExtractJobData>(
  "contract.extract",
  { connection },
)

export const contractAiExtractQueue = new Queue<ContractAiExtractJobData>(
  "contract.ai_extract",
  { connection },
)

export const contractEmbedQueue = new Queue<ContractEmbedJobData>(
  "contract.embed",
  { connection },
)

export const alertsCheckQueue = new Queue<AlertsCheckJobData>(
  "alerts.check",
  { connection },
)

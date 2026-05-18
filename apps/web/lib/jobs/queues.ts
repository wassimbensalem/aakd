import { Queue } from "bullmq"

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379"
const connection = {
  url: REDIS_URL,
  maxRetriesPerRequest: null,
  ...(REDIS_URL.startsWith("rediss://") ? { tls: {} } : {}),
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

export interface ObligationsCheckJobData {
  triggeredAt: string
}

export interface SalesforcePollJobData {
  triggeredAt: string
}

// ─── M10: Import processing ──────────────────────────────────────────────────

export interface ImportProcessJobData {
  importJobId: string
  organizationId: string
  createdById: string
}

export interface ContractEmbedJobData {
  contractId: string
  extractedText: string
}

export interface SigningSyncJobData {
  triggeredAt: string
  contractId?: string
  submissionId?: string
}

// Email send queue — covers any transactional email triggered from a route
// or other worker so the API/job that produces the event isn't blocked on
// SMTP latency.
export type EmailJobData =
  | { kind: "alert"; alertId: string }
  | {
      kind: "approval_request"
      to: string
      assigneeName: string
      requesterName: string
      contractTitle: string
      message?: string
    }
  | {
      kind: "approval_rejected"
      to: string
      requesterName: string
      reviewerName: string
      contractTitle: string
      comment?: string
    }
  | {
      kind: "event_notification"
      eventName: string
      to: string
      contractId: string
      contractTitle: string
      actorName: string | null
      metadata: Record<string, string | number | boolean | null>
      unsubscribeToken: string
    }

// ─── M7: Obligation AI extraction ────────────────────────────────────────────

export interface ObligationExtractJobData {
  contractId: string
  extractedText: string  // passed in so the worker doesn't need a DB read
  requestedById: string
}

// ─── M6: Authoring (Word import / DOCX+PDF export) ───────────────────────────

export interface DocumentConvertJobData {
  contractId: string
  storageKey: string
  requestedById: string
  jobId: string
  fileType: "docx" | "pdf"
}

export interface DocumentExportJobData {
  contractId: string
  format: "docx" | "pdf"
  requestedById: string
  jobId: string
}

// ─── M5: Notification fan-out + delivery ──────────────────────────────────────

export interface NotificationFanoutJobData {
  eventName: string
  contractId: string
  actorId: string | null
  metadata: Record<string, string | number | boolean | null>
}

export type NotificationDeliverJobData =
  | {
      kind: "slack" | "teams"
      channelId: string
      eventName: string
      contractId: string
      contractTitle: string
      counterpartyName: string | null
      actorName: string | null
      appUrl: string
      metadata: Record<string, string | number | boolean | null>
    }
  | {
      kind: "webhook"
      webhookId: string
      deliveryLogId: string
      attempt: number
      payload: string
      signature: string
    }

// ─── Lazy queue singletons ────────────────────────────────────────────────────
// Queue instances are created on first use (not at module load time) so that
// Next.js's static-generation phase during `next build` does not attempt a
// Redis connection. Callers should use these getters, not the raw constructors.

let _contractExtractQueue: Queue<ContractExtractJobData> | null = null
let _contractAiExtractQueue: Queue<ContractAiExtractJobData> | null = null
let _contractEmbedQueue: Queue<ContractEmbedJobData> | null = null
let _alertsCheckQueue: Queue<AlertsCheckJobData> | null = null
let _signingSyncQueue: Queue<SigningSyncJobData> | null = null
let _emailQueue: Queue<EmailJobData> | null = null
let _notificationFanoutQueue: Queue<NotificationFanoutJobData> | null = null
let _notificationDeliverQueue: Queue<NotificationDeliverJobData> | null = null
let _documentConvertQueue: Queue<DocumentConvertJobData> | null = null
let _documentExportQueue: Queue<DocumentExportJobData> | null = null
let _obligationsCheckQueue: Queue<ObligationsCheckJobData> | null = null
let _salesforcePollQueue: Queue<SalesforcePollJobData> | null = null
let _importProcessQueue: Queue<ImportProcessJobData> | null = null
let _obligationExtractQueue: Queue<ObligationExtractJobData> | null = null

export function getContractExtractQueue(): Queue<ContractExtractJobData> {
  return (_contractExtractQueue ??= new Queue<ContractExtractJobData>("contract.extract", { connection }))
}

export function getContractAiExtractQueue(): Queue<ContractAiExtractJobData> {
  return (_contractAiExtractQueue ??= new Queue<ContractAiExtractJobData>("contract.ai_extract", { connection }))
}

export function getContractEmbedQueue(): Queue<ContractEmbedJobData> {
  return (_contractEmbedQueue ??= new Queue<ContractEmbedJobData>("contract.embed", { connection }))
}

export function getAlertsCheckQueue(): Queue<AlertsCheckJobData> {
  return (_alertsCheckQueue ??= new Queue<AlertsCheckJobData>("alerts.check", { connection }))
}

export function getSigningSyncQueue(): Queue<SigningSyncJobData> {
  return (_signingSyncQueue ??= new Queue<SigningSyncJobData>("signing.sync", { connection }))
}

export function getEmailQueue(): Queue<EmailJobData> {
  // attempts: 1 — sendMail is not idempotent. If the SMTP send succeeds but
  // the worker crashes before BullMQ commits the job result, a retry would
  // duplicate the email. Failed jobs land in the BullMQ failed queue.
  return (_emailQueue ??= new Queue<EmailJobData>("email.send", {
    connection,
    defaultJobOptions: { attempts: 1 },
  }))
}

export function getNotificationFanoutQueue(): Queue<NotificationFanoutJobData> {
  return (_notificationFanoutQueue ??= new Queue<NotificationFanoutJobData>(
    "notification.fanout",
    {
      connection,
      defaultJobOptions: { removeOnComplete: 200, removeOnFail: 500 },
    }
  ))
}

export function getNotificationDeliverQueue(): Queue<NotificationDeliverJobData> {
  return (_notificationDeliverQueue ??= new Queue<NotificationDeliverJobData>(
    "notification.deliver",
    {
      connection,
      defaultJobOptions: { removeOnComplete: 500, removeOnFail: 500 },
    }
  ))
}

export function getDocumentConvertQueue(): Queue<DocumentConvertJobData> {
  return (_documentConvertQueue ??= new Queue<DocumentConvertJobData>(
    "document.convert",
    {
      connection,
      defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200, attempts: 1 },
    }
  ))
}

export function getDocumentExportQueue(): Queue<DocumentExportJobData> {
  return (_documentExportQueue ??= new Queue<DocumentExportJobData>(
    "document.export",
    {
      connection,
      defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200, attempts: 1 },
    }
  ))
}

export function getObligationsCheckQueue(): Queue<ObligationsCheckJobData> {
  return (_obligationsCheckQueue ??= new Queue<ObligationsCheckJobData>(
    "obligations.check",
    { connection },
  ))
}

export function getSalesforcePollQueue(): Queue<SalesforcePollJobData> {
  return (_salesforcePollQueue ??= new Queue<SalesforcePollJobData>(
    "salesforce.poll",
    { connection },
  ))
}

export function getObligationExtractQueue(): Queue<ObligationExtractJobData> {
  return (_obligationExtractQueue ??= new Queue<ObligationExtractJobData>(
    "obligations.ai_extract",
    {
      connection,
      defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200, attempts: 1 },
    }
  ))
}

export function getImportProcessQueue(): Queue<ImportProcessJobData> {
  // attempts: 1 — partial progress is persisted per ImportRow as the worker
  // streams through the file. A retry would re-process completed rows; instead
  // we expose a manual /api/import/[jobId]/retry endpoint that resets only the
  // failed rows.
  return (_importProcessQueue ??= new Queue<ImportProcessJobData>("import.process", {
    connection,
    defaultJobOptions: { attempts: 1, removeOnComplete: 200, removeOnFail: 500 },
  }))
}

// ─── Legacy named exports (kept for backward compat) ─────────────────────────
// These are getters so the Queue is still created lazily. We proxy both `add`
// (used by API routes / worker handlers) and `close` (used by graceful shutdown).
export const contractExtractQueue = {
  add: (...a: Parameters<Queue<ContractExtractJobData>["add"]>) => getContractExtractQueue().add(...a),
  close: () => _contractExtractQueue?.close() ?? Promise.resolve(),
}
export const contractAiExtractQueue = {
  add: (...a: Parameters<Queue<ContractAiExtractJobData>["add"]>) => getContractAiExtractQueue().add(...a),
  close: () => _contractAiExtractQueue?.close() ?? Promise.resolve(),
}
export const contractEmbedQueue = {
  add: (...a: Parameters<Queue<ContractEmbedJobData>["add"]>) => getContractEmbedQueue().add(...a),
  close: () => _contractEmbedQueue?.close() ?? Promise.resolve(),
}
export const alertsCheckQueue = {
  add: (...a: Parameters<Queue<AlertsCheckJobData>["add"]>) => getAlertsCheckQueue().add(...a),
  close: () => _alertsCheckQueue?.close() ?? Promise.resolve(),
}
export const signingSyncQueue = {
  add: (...a: Parameters<Queue<SigningSyncJobData>["add"]>) => getSigningSyncQueue().add(...a),
  close: () => _signingSyncQueue?.close() ?? Promise.resolve(),
}
export const emailQueue = {
  add: (...a: Parameters<Queue<EmailJobData>["add"]>) => getEmailQueue().add(...a),
  close: () => _emailQueue?.close() ?? Promise.resolve(),
}
export const notificationFanoutQueue = {
  add: (...a: Parameters<Queue<NotificationFanoutJobData>["add"]>) =>
    getNotificationFanoutQueue().add(...a),
  close: () => _notificationFanoutQueue?.close() ?? Promise.resolve(),
}
export const notificationDeliverQueue = {
  add: (...a: Parameters<Queue<NotificationDeliverJobData>["add"]>) =>
    getNotificationDeliverQueue().add(...a),
  close: () => _notificationDeliverQueue?.close() ?? Promise.resolve(),
}
export const documentConvertQueue = {
  add: (...a: Parameters<Queue<DocumentConvertJobData>["add"]>) =>
    getDocumentConvertQueue().add(...a),
  close: () => _documentConvertQueue?.close() ?? Promise.resolve(),
}
export const documentExportQueue = {
  add: (...a: Parameters<Queue<DocumentExportJobData>["add"]>) =>
    getDocumentExportQueue().add(...a),
  close: () => _documentExportQueue?.close() ?? Promise.resolve(),
}
export const obligationsCheckQueue = {
  add: (...a: Parameters<Queue<ObligationsCheckJobData>["add"]>) =>
    getObligationsCheckQueue().add(...a),
  close: () => _obligationsCheckQueue?.close() ?? Promise.resolve(),
}
export const salesforcePollQueue = {
  add: (...a: Parameters<Queue<SalesforcePollJobData>["add"]>) =>
    getSalesforcePollQueue().add(...a),
  close: () => _salesforcePollQueue?.close() ?? Promise.resolve(),
}
export const importProcessQueue = {
  add: (...a: Parameters<Queue<ImportProcessJobData>["add"]>) =>
    getImportProcessQueue().add(...a),
  close: () => _importProcessQueue?.close() ?? Promise.resolve(),
}
export const obligationExtractQueue = {
  add: (...a: Parameters<Queue<ObligationExtractJobData>["add"]>) =>
    getObligationExtractQueue().add(...a),
  close: () => _obligationExtractQueue?.close() ?? Promise.resolve(),
}

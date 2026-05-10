export const NOTIFICATION_EVENTS = [
  "contract.uploaded",
  "contract.extracted",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "contract.sent_for_signing",
  "contract.signed",
  "contract.expiring_soon",
  "contract.expired",
  "contract.archived",
  "obligation.due_soon",
  "obligation.overdue",
] as const

export type NotificationEventName = (typeof NOTIFICATION_EVENTS)[number]

export const NOTIFICATION_EVENT_SET: ReadonlySet<string> = new Set(NOTIFICATION_EVENTS)

export const DEFAULT_EMAIL_ENABLED: Record<NotificationEventName, boolean> = {
  "contract.uploaded": false,
  "contract.extracted": false,
  "approval.requested": true,
  "approval.approved": true,
  "approval.rejected": true,
  "contract.sent_for_signing": false,
  "contract.signed": true,
  "contract.expiring_soon": true,
  "contract.expired": true,
  "contract.archived": false,
  "obligation.due_soon": true,
  "obligation.overdue": true,
}

export const EVENT_LABELS: Record<NotificationEventName, string> = {
  "contract.uploaded": "Contract file uploaded",
  "contract.extracted": "AI metadata extracted",
  "approval.requested": "Approval request assigned to me",
  "approval.approved": "Approval decision: approved",
  "approval.rejected": "Approval decision: rejected",
  "contract.sent_for_signing": "Contract sent for signing",
  "contract.signed": "Contract signed",
  "contract.expiring_soon": "Contract expiring soon",
  "contract.expired": "Contract expired",
  "contract.archived": "Contract archived",
  "obligation.due_soon": "Obligation due soon",
  "obligation.overdue": "Obligation overdue",
}

export function isNotificationEventName(s: string): s is NotificationEventName {
  return NOTIFICATION_EVENT_SET.has(s)
}

/** Alias kept for callers that use the HUMAN_EVENT_LABELS name from fanout.ts. */
export const HUMAN_EVENT_LABELS: Record<NotificationEventName, string> = EVENT_LABELS

/** Semver-style API version sent in every outbound webhook payload. */
export const WEBHOOK_API_VERSION = "2026-05-01"

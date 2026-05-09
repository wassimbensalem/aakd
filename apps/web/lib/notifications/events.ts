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
}

export function isNotificationEventName(s: string): s is NotificationEventName {
  return NOTIFICATION_EVENT_SET.has(s)
}

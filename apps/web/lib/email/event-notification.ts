import nodemailer from "nodemailer"
import {
  HUMAN_EVENT_LABELS,
  type NotificationEventName,
} from "@/lib/notifications/fanout"

export interface EventNotificationEmailParams {
  to: string
  eventName: string
  contractId: string
  contractTitle: string
  actorName: string | null
  orgName: string
  metadata: Record<string, string | number | boolean | null>
  unsubscribeToken: string
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function eventLabel(eventName: string): string {
  return HUMAN_EVENT_LABELS[eventName as NotificationEventName] ?? eventName
}

interface MetadataRow {
  label: string
  value: string
}

function metadataRows(
  eventName: string,
  metadata: Record<string, string | number | boolean | null>,
): MetadataRow[] {
  const rows: MetadataRow[] = []

  if (eventName === "approval.requested") {
    if (typeof metadata.assigneeName === "string") rows.push({ label: "Assignee", value: metadata.assigneeName })
    if (typeof metadata.requesterName === "string") rows.push({ label: "Requested by", value: metadata.requesterName })
    if (typeof metadata.message === "string" && metadata.message.length > 0) {
      rows.push({ label: "Message", value: metadata.message })
    }
  }
  if (eventName === "approval.approved" || eventName === "approval.rejected") {
    if (typeof metadata.decidedByName === "string") rows.push({ label: "Decided by", value: metadata.decidedByName })
    if (typeof metadata.comment === "string" && metadata.comment.length > 0) {
      rows.push({ label: "Comment", value: metadata.comment })
    }
  }
  if (eventName === "contract.expiring_soon" && typeof metadata.daysUntilExpiry === "number") {
    rows.push({ label: "Expires in", value: `${metadata.daysUntilExpiry} day${metadata.daysUntilExpiry === 1 ? "" : "s"}` })
  }
  return rows
}

function renderRow(label: string, value: string): string {
  return `
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 0;color:#6b7280;width:40%">${escapeHtml(label)}</td>
        <td style="padding:10px 0;font-weight:500">${escapeHtml(value)}</td>
      </tr>`
}

function buildEventHtml(params: EventNotificationEmailParams, appUrl: string): string {
  const { eventName, contractId, contractTitle, actorName, orgName, metadata, unsubscribeToken } = params
  const label = eventLabel(eventName)
  const actor = actorName ?? "System"
  const contractUrl = `${appUrl}/contracts/${contractId}`
  const unsubscribeUrl = `${appUrl}/api/user/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`

  const extraRows = metadataRows(eventName, metadata)
    .map((r) => renderRow(r.label, r.value))
    .join("")

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;color:#1f2937;background:#f9fafb;padding:24px;margin:0">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e5e7eb;padding:32px">
    <h2 style="margin:0 0 24px;font-size:18px;font-weight:600;color:#111827">${escapeHtml(label)}</h2>

    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${renderRow("Contract", contractTitle)}
      ${renderRow("Actor", actor)}
      ${extraRows}
    </table>

    <div style="margin-top:32px;text-align:left">
      <a href="${escapeHtml(contractUrl)}"
         style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:500">
        View Contract
      </a>
    </div>

    <p style="margin:32px 0 0;font-size:12px;color:#9ca3af;line-height:1.5">
      You're receiving this because you're a member of ${escapeHtml(orgName)}.
      <a href="${escapeHtml(unsubscribeUrl)}" style="color:#9ca3af;text-decoration:underline">
        Unsubscribe from ${escapeHtml(label)} emails
      </a>.
    </p>
  </div>
</body>
</html>`.trim()
}

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "localhost",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  })
}

export async function sendEventNotificationEmail(
  params: EventNotificationEmailParams,
): Promise<void> {
  if (!process.env.SMTP_HOST) return

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:3000"

  const label = eventLabel(params.eventName)
  const subject = `[ClauseFlow] ${label} — ${params.contractTitle}`

  const transporter = getTransporter()
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? "noreply@clauseflow.io",
    to: params.to,
    subject,
    html: buildEventHtml(params, appUrl),
  })
}

import nodemailer from "nodemailer"
import { ContractAlert, Contract, Organization } from "@prisma/client"

export type ContractAlertWithContract = ContractAlert & {
  contract: Contract & { organization: Organization }
}

const ALERT_LABELS: Record<string, string> = {
  EXPIRY_90:     "Expiry Warning (90 days)",
  EXPIRY_30:     "Expiry Warning (30 days)",
  EXPIRY_7:      "Expiry Warning (7 days)",
  RENEWAL_DUE:   "Renewal Due",
  NOTICE_PERIOD: "Notice Period",
}

function buildAlertHtml(alert: ContractAlertWithContract): string {
  const { contract } = alert
  const endDate = contract.endDate
    ? new Date(contract.endDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "N/A"
  const triggerDate = new Date(alert.triggerDate).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  const label = ALERT_LABELS[alert.alertType] ?? alert.alertType

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;color:#1f2937;background:#f9fafb;padding:24px;margin:0">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e5e7eb;padding:32px">
    <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#111827">Contract Renewal Alert</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px">${label}</p>

    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 0;color:#6b7280;width:40%">Contract</td>
        <td style="padding:10px 0;font-weight:500">${escapeHtml(contract.title)}</td>
      </tr>
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 0;color:#6b7280">Alert Type</td>
        <td style="padding:10px 0;font-weight:500">${escapeHtml(label)}</td>
      </tr>
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 0;color:#6b7280">End Date</td>
        <td style="padding:10px 0;font-weight:500">${endDate}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:#6b7280">Alert Triggered</td>
        <td style="padding:10px 0;font-weight:500">${triggerDate}</td>
      </tr>
    </table>

    ${contract.counterpartyName ? `<p style="margin:24px 0 0;font-size:13px;color:#6b7280">Counterparty: <strong>${escapeHtml(contract.counterpartyName)}</strong></p>` : ""}
    <p style="margin:24px 0 0;font-size:12px;color:#9ca3af">This is an automated alert from ClauseFlow. Please log in to review the contract.</p>
  </div>
</body>
</html>`.trim()
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
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

export async function sendAlertEmail(alert: ContractAlertWithContract): Promise<void> {
  // Silently skip if SMTP is not configured
  if (!process.env.SMTP_HOST) return

  const to = process.env.ALERT_EMAIL_TO
  if (!to) return

  const label = ALERT_LABELS[alert.alertType] ?? alert.alertType
  const subject = `[ClauseFlow] ${label} — ${alert.contract.title}`

  const transporter = getTransporter()
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? "noreply@clauseflow.io",
    to,
    subject,
    html: buildAlertHtml(alert),
  })
}

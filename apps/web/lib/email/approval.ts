import nodemailer from "nodemailer"

interface ApprovalRequestEmailParams {
  to: string
  assigneeName: string
  requesterName: string
  contractTitle: string
  message?: string
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function buildApprovalRequestHtml(params: ApprovalRequestEmailParams): string {
  const { assigneeName, requesterName, contractTitle, message } = params
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;color:#1f2937;background:#f9fafb;padding:24px;margin:0">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e5e7eb;padding:32px">
    <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#111827">Approval Requested</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px">Hi ${escapeHtml(assigneeName)}, you have been asked to review a contract.</p>

    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 0;color:#6b7280;width:40%">Contract</td>
        <td style="padding:10px 0;font-weight:500">${escapeHtml(contractTitle)}</td>
      </tr>
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 0;color:#6b7280">Requested by</td>
        <td style="padding:10px 0;font-weight:500">${escapeHtml(requesterName)}</td>
      </tr>
    </table>

    ${message ? `<div style="margin-top:24px;padding:16px;background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb"><p style="margin:0;font-size:13px;color:#374151"><strong>Message:</strong> ${escapeHtml(message)}</p></div>` : ""}

    <p style="margin:24px 0 0;font-size:12px;color:#9ca3af">This is an automated notification from Aakd. Please log in to review and decide on this approval.</p>
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

export async function sendApprovalRequestEmail(params: ApprovalRequestEmailParams): Promise<void> {
  // Silently skip if SMTP is not configured
  if (!process.env.SMTP_HOST) return

  const transporter = getTransporter()
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? "noreply@aakd.io",
    to: params.to,
    subject: `[Aakd] Approval requested — ${params.contractTitle}`,
    html: buildApprovalRequestHtml(params),
  })
}

// ─── Approval Rejection Email ─────────────────────────────────────────────────

interface ApprovalRejectionEmailParams {
  to: string
  requesterName: string
  reviewerName: string
  contractTitle: string
  comment?: string
}

function buildApprovalRejectionHtml(params: ApprovalRejectionEmailParams): string {
  const { requesterName, reviewerName, contractTitle, comment } = params
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;color:#1f2937;background:#f9fafb;padding:24px;margin:0">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e5e7eb;padding:32px">
    <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#111827">Approval Rejected</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px">Hi ${escapeHtml(requesterName)}, your approval request was rejected.</p>

    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 0;color:#6b7280;width:40%">Contract</td>
        <td style="padding:10px 0;font-weight:500">${escapeHtml(contractTitle)}</td>
      </tr>
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 0;color:#6b7280">Reviewed by</td>
        <td style="padding:10px 0;font-weight:500">${escapeHtml(reviewerName)}</td>
      </tr>
    </table>

    ${comment ? `<div style="margin-top:24px;padding:16px;background:#fff5f5;border-radius:6px;border:1px solid #fecaca"><p style="margin:0;font-size:13px;color:#374151"><strong>Reviewer's comment:</strong> ${escapeHtml(comment)}</p></div>` : ""}

    <p style="margin:24px 0 0;font-size:12px;color:#9ca3af">Please review the feedback, make the necessary changes, and re-submit for approval.</p>
  </div>
</body>
</html>`.trim()
}

export async function sendApprovalRejectionEmail(params: ApprovalRejectionEmailParams): Promise<void> {
  if (!process.env.SMTP_HOST) return

  const transporter = getTransporter()
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? "noreply@aakd.io",
    to: params.to,
    subject: `[Aakd] Approval rejected — ${params.contractTitle}`,
    html: buildApprovalRejectionHtml(params),
  })
}

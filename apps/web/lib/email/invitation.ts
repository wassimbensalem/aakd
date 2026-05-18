import nodemailer from "nodemailer"

interface InvitationEmailParams {
  to: string
  organizationName: string
  inviterName: string
  acceptUrl: string
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function buildInvitationHtml(params: InvitationEmailParams): string {
  const { organizationName, inviterName, acceptUrl } = params
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;color:#1f2937;background:#f9fafb;padding:24px;margin:0">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e5e7eb;padding:32px">
    <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#111827">You're invited to ${escapeHtml(organizationName)}</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px">${escapeHtml(inviterName)} has invited you to join their workspace on Aakd.</p>

    <p style="margin:24px 0">
      <a href="${escapeHtml(acceptUrl)}" style="display:inline-block;background:#111827;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500">Accept invitation</a>
    </p>

    <p style="margin:24px 0 0;font-size:12px;color:#9ca3af">If the button doesn't work, copy and paste this link: <br/>${escapeHtml(acceptUrl)}</p>
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

export async function sendInvitationEmail(params: InvitationEmailParams): Promise<void> {
  if (!process.env.SMTP_HOST) return

  const transporter = getTransporter()
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? "noreply@aakd.io",
    to: params.to,
    subject: `You've been invited to ${params.organizationName} on Aakd`,
    html: buildInvitationHtml(params),
  })
}

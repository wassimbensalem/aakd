import { betterAuth } from "better-auth"
import { organization } from "better-auth/plugins"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { prisma } from "@/lib/db/client"
import { sendInvitationEmail } from "@/lib/email/invitation"

const authOrigin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000"
const publicAppOrigin = process.env.NEXT_PUBLIC_APP_URL ?? authOrigin
const devOrigins =
  process.env.NODE_ENV === "production"
    ? []
    : Array.from({ length: 10 }, (_, i) => `http://localhost:${3000 + i}`)

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    async sendResetPassword({ user, url }) {
      if (!process.env.SMTP_HOST) return // silently skip if SMTP not configured
      const nodemailer = await import("nodemailer")
      const transporter = nodemailer.default.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      })
      await transporter.sendMail({
        from: process.env.SMTP_FROM ?? "noreply@clauseflow.io",
        to: user.email,
        subject: "[ClauseFlow] Reset your password",
        html: `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;color:#1f2937;background:#f9fafb;padding:24px;margin:0">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e5e7eb;padding:32px">
    <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#111827">Reset your password</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px">Click the button below to set a new password. This link expires in 1 hour.</p>
    <a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;font-size:14px;font-weight:500;padding:10px 20px;border-radius:6px;text-decoration:none">Reset password</a>
    <p style="margin:24px 0 0;font-size:12px;color:#9ca3af">If you didn't request this, you can safely ignore this email.</p>
  </div>
</body></html>`.trim(),
      })
    },
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      membershipLimit: 100,
      async sendInvitationEmail(data) {
        const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000"
        const acceptUrl = `${baseUrl}/accept-invitation?id=${data.id}`
        await sendInvitationEmail({
          to: data.email,
          organizationName: data.organization.name,
          inviterName: data.inviter.user.name ?? data.inviter.user.email ?? "A teammate",
          acceptUrl,
        }).catch((err) => {
          // Failing to send the email should not abort the invitation;
          // the row is already persisted and can be resent.
          console.error("[invitation] sendInvitationEmail failed:", err)
        })
      },
    }),
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24,       // refresh if 1 day old
  },
  trustedOrigins: Array.from(new Set([authOrigin, publicAppOrigin, ...devOrigins])),
})

export type Auth = typeof auth

import { betterAuth } from "better-auth"
import { organization } from "better-auth/plugins"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { prisma } from "@/lib/db/client"
import { sendInvitationEmail } from "@/lib/email/invitation"

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
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
  trustedOrigins: [process.env.BETTER_AUTH_URL ?? "http://localhost:3000"],
})

export type Auth = typeof auth

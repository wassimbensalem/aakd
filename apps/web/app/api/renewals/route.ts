import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit"

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const rl = await rateLimit(`${ctx.organizationId}:renewals`, 60, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter)

  return requestContext.run(ctx, async () => {
    const contracts = await prisma.contract.findMany({
      where: {
        organizationId: ctx.organizationId,
        autoRenewal: true,
        status: { not: "ARCHIVED" },
      },
      select: {
        id: true,
        title: true,
        counterpartyName: true,
        endDate: true,
        noticePeriodDays: true,
        value: true,
        currency: true,
        riskScore: true,
        status: true,
      },
    })

    const now = Date.now()

    const withDeadlines = contracts.map((c) => {
      let noticeDeadlineDate: Date | null = null
      let daysUntilDeadline: number | null = null

      if (c.endDate && c.noticePeriodDays != null) {
        noticeDeadlineDate = new Date(c.endDate.getTime() - c.noticePeriodDays * 86_400_000)
        daysUntilDeadline = (noticeDeadlineDate.getTime() - now) / 86_400_000
      }

      return {
        ...c,
        noticeDeadlineDate,
        daysUntilDeadline,
      }
    })

    // Sort ascending by daysUntilDeadline — most urgent first.
    // Contracts without a deadline go to the end.
    withDeadlines.sort((a, b) => {
      if (a.daysUntilDeadline == null && b.daysUntilDeadline == null) return 0
      if (a.daysUntilDeadline == null) return 1
      if (b.daysUntilDeadline == null) return -1
      return a.daysUntilDeadline - b.daysUntilDeadline
    })

    return Response.json({ renewals: withDeadlines })
  })
}

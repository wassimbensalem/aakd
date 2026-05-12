import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"

export type AnalyticsSummary = {
  expiringSoon: {
    next30: number
    next60: number
    next90: number
    contracts: Array<{
      id: string
      title: string
      endDate: string
      counterpartyName: string | null
      contractType: string | null
      daysUntilExpiry: number
    }>
  }
  byStatus: Array<{ status: string; count: number }>
  monthlyVolume: Array<{ month: string; count: number }>
  valueByType: Array<{ contractType: string; totalValue: number; count: number }>
  approvalFunnel: {
    totalRequested: number
    approved: number
    rejected: number
    pending: number
  }
  obligations: { overdue: number; dueSoon: number } | null
}

const DAY_MS = 86_400_000

function daysBetween(now: Date, end: Date): number {
  return Math.ceil((end.getTime() - now.getTime()) / DAY_MS)
}

function startOfMonthUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function formatMonthKey(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, "0")
  return `${y}-${m}`
}

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const now = new Date()
    const d30 = new Date(now.getTime() + 30 * DAY_MS)
    const d60 = new Date(now.getTime() + 60 * DAY_MS)
    const d90 = new Date(now.getTime() + 90 * DAY_MS)

    // 12 months window: floor(now) - 11 months → start of that month
    const twelveMonthsAgo = startOfMonthUTC(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)),
    )

    // ── 1. Expiring Soon ──────────────────────────────────────────────────
    // Single batched raw query for the three cumulative counts + top 10 soonest.
    // Raw query requires explicit org predicate (not auto-scoped).
    const [expiringCounts, expiringContracts] = await Promise.all([
      prisma.$queryRaw<Array<{ next30: bigint; next60: bigint; next90: bigint }>>`
        SELECT
          COUNT(*) FILTER (WHERE "endDate" <= ${d30})::bigint AS next30,
          COUNT(*) FILTER (WHERE "endDate" <= ${d60})::bigint AS next60,
          COUNT(*) FILTER (WHERE "endDate" <= ${d90})::bigint AS next90
        FROM "Contract"
        WHERE "organizationId" = ${ctx.organizationId}
          AND status = 'ACTIVE'
          AND "endDate" >= ${now}
          AND "endDate" <= ${d90}
      `,
      prisma.contract.findMany({
        where: { organizationId: ctx.organizationId, status: "ACTIVE", endDate: { gte: now, lte: d90 } },
        orderBy: { endDate: "asc" },
        take: 10,
        select: {
          id: true,
          title: true,
          endDate: true,
          counterpartyName: true,
          contractType: true,
        },
      }),
    ])
    const next30 = Number(expiringCounts[0]?.next30 ?? 0)
    const next60 = Number(expiringCounts[0]?.next60 ?? 0)
    const next90 = Number(expiringCounts[0]?.next90 ?? 0)

    const expiringSoon = {
      next30,
      next60,
      next90,
      contracts: expiringContracts.map((c) => ({
        id: c.id,
        title: c.title,
        endDate: c.endDate ? c.endDate.toISOString() : "",
        counterpartyName: c.counterpartyName ?? null,
        contractType: c.contractType ?? null,
        daysUntilExpiry: c.endDate ? daysBetween(now, c.endDate) : 0,
      })),
    }

    // ── 2. By Status ──────────────────────────────────────────────────────
    // groupBy is NOT auto-scoped by the Prisma extension — must add the
    // organizationId predicate manually.
    const grouped = await prisma.contract.groupBy({
      by: ["status"],
      where: { organizationId: ctx.organizationId },
      _count: { _all: true },
    })
    const byStatus = grouped.map((g) => ({
      status: g.status,
      count: g._count._all,
    }))

    // ── 3. Monthly Volume ─────────────────────────────────────────────────
    // Raw query — also requires explicit org predicate.
    const rows = await prisma.$queryRaw<Array<{ month: string; count: bigint }>>`
      SELECT TO_CHAR(DATE_TRUNC('month', "createdAt"), 'YYYY-MM') AS month,
             COUNT(*)::bigint AS count
      FROM "Contract"
      WHERE "organizationId" = ${ctx.organizationId}
        AND "createdAt" >= ${twelveMonthsAgo}
      GROUP BY 1
      ORDER BY 1 ASC
    `
    const rowsByMonth = new Map(rows.map((r) => [r.month, Number(r.count)]))
    const monthlyVolume: Array<{ month: string; count: number }> = []
    for (let i = 0; i < 12; i++) {
      const d = new Date(
        Date.UTC(twelveMonthsAgo.getUTCFullYear(), twelveMonthsAgo.getUTCMonth() + i, 1),
      )
      const key = formatMonthKey(d)
      monthlyVolume.push({ month: key, count: rowsByMonth.get(key) ?? 0 })
    }

    // ── 4. Value by Type ──────────────────────────────────────────────────
    const valueGrouped = await prisma.contract.groupBy({
      by: ["contractType"],
      where: { organizationId: ctx.organizationId, value: { not: null } },
      _sum: { value: true },
      _count: { _all: true },
    })
    const valueByType = valueGrouped
      .filter((g) => g.contractType !== null)
      .map((g) => ({
        contractType: g.contractType as string,
        totalValue: g._sum.value ?? 0,
        count: g._count._all,
      }))

    // ── 5. Approval Funnel ────────────────────────────────────────────────
    // Single batched raw query for all three counts.
    const approvalRows = await prisma.$queryRaw<Array<{ total: bigint; approved: bigint; rejected: bigint }>>`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE a.status = 'approved')::bigint AS approved,
        COUNT(*) FILTER (WHERE a.status = 'rejected')::bigint AS rejected
      FROM "Approval" a
      JOIN "Contract" c ON c.id = a."contractId"
      WHERE c."organizationId" = ${ctx.organizationId}
    `
    const totalRequested = Number(approvalRows[0]?.total ?? 0)
    const approved = Number(approvalRows[0]?.approved ?? 0)
    const rejected = Number(approvalRows[0]?.rejected ?? 0)
    const approvalFunnel = {
      totalRequested,
      approved,
      rejected,
      pending: Math.max(0, totalRequested - approved - rejected),
    }

    // ── 6. Obligations (graceful degradation) ─────────────────────────────
    let obligations: AnalyticsSummary["obligations"] = null
    try {
      const dueSoonCutoff = new Date(now.getTime() + 7 * DAY_MS)
      const oblRows = await prisma.$queryRaw<Array<{ overdue: bigint; dueSoon: bigint }>>`
        SELECT
          COUNT(*) FILTER (WHERE o.status = 'OVERDUE')::bigint AS overdue,
          COUNT(*) FILTER (WHERE o.status IN ('PENDING','IN_PROGRESS') AND o."dueDate" <= ${dueSoonCutoff})::bigint AS "dueSoon"
        FROM "ContractObligation" o
        JOIN "Contract" c ON c.id = o."contractId"
        WHERE c."organizationId" = ${ctx.organizationId}
      `
      obligations = {
        overdue: Number(oblRows[0]?.overdue ?? 0),
        dueSoon: Number(oblRows[0]?.dueSoon ?? 0),
      }
    } catch {
      obligations = null
    }

    const body: AnalyticsSummary = {
      expiringSoon,
      byStatus,
      monthlyVolume,
      valueByType,
      approvalFunnel,
      obligations,
    }
    return Response.json(body)
  })
}

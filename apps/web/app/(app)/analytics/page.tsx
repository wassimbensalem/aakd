import { cookies } from "next/headers"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ExpiringSoonWidget } from "@/components/analytics/expiring-soon-widget"
import { PortfolioHealthWidget } from "@/components/analytics/portfolio-health-widget"
import { MonthlyVolumeWidget } from "@/components/analytics/monthly-volume-widget"
import { ValueByTypeWidget } from "@/components/analytics/value-by-type-widget"
import { ApprovalFunnelWidget } from "@/components/analytics/approval-funnel-widget"
import { ObligationSummaryWidget } from "@/components/analytics/obligation-summary-widget"
import type { AnalyticsSummary } from "@/app/api/analytics/summary/route"

async function fetchSummary(): Promise<AnalyticsSummary | null> {
  try {
    const cookieStore = await cookies()
    const res = await fetch(
      `${process.env.INTERNAL_APP_URL ?? "http://localhost:3000"}/api/analytics/summary`,
      { headers: { cookie: cookieStore.toString() }, cache: "no-store" },
    )
    if (!res.ok) return null
    return (await res.json()) as AnalyticsSummary
  } catch {
    return null
  }
}

export default async function AnalyticsPage() {
  const data = await fetchSummary()
  const lastUpdated = new Date().toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })

  if (!data) {
    return (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Analytics</h1>
          <p className="text-sm text-muted-foreground">Contract portfolio overview</p>
        </div>
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center">
          <p className="text-sm text-zinc-500">
            Failed to load analytics data. Please refresh the page.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Contract portfolio overview · Last updated {lastUpdated}
          </p>
        </div>
      </div>

      {/* Row 1 — three columns on lg */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Expiring Soon</CardTitle>
          </CardHeader>
          <CardContent>
            <ExpiringSoonWidget data={data.expiringSoon} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Portfolio Health</CardTitle>
          </CardHeader>
          <CardContent>
            <PortfolioHealthWidget data={data.byStatus} />
          </CardContent>
        </Card>

        {data.obligations !== null && (
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Obligation Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <ObligationSummaryWidget data={data.obligations} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Row 2 — two columns on lg */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Monthly Volume</CardTitle>
          </CardHeader>
          <CardContent>
            <MonthlyVolumeWidget data={data.monthlyVolume} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Value by Type</CardTitle>
          </CardHeader>
          <CardContent>
            <ValueByTypeWidget data={data.valueByType} />
          </CardContent>
        </Card>
      </div>

      {/* Row 3 — full width */}
      <Card>
        <CardHeader>
          <CardTitle>Approval Funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <ApprovalFunnelWidget data={data.approvalFunnel} />
        </CardContent>
      </Card>
    </div>
  )
}

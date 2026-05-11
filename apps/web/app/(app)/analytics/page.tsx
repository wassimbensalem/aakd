import { cookies } from "next/headers"
import { AnalyticsClient } from "@/components/analytics/analytics-client"
import type { AnalyticsSummary } from "@/app/api/analytics/summary/route"
import { getTranslations } from "next-intl/server"

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
  const t = await getTranslations("analytics")

  if (!data) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-7 py-4 border-b border-border shrink-0">
          <div>
            <h1 className="text-xl font-semibold">{t("title")}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("subtitle")}
            </p>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="rounded-[var(--radius)] border border-dashed border-border bg-card p-10 text-center">
            <p className="text-sm text-muted-foreground">
              {t("failedToLoad")}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return <AnalyticsClient data={data} />
}

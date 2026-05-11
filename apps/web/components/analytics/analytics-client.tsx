"use client"

import { useState } from "react"
import { MonthlyVolumeWidget } from "./monthly-volume-widget"
import { StatusDonutWidget } from "./status-donut-widget"
import { ValueByTypeWidget } from "./value-by-type-widget"
import { ApprovalFunnelWidget } from "./approval-funnel-widget"
import { ExpiringSoonWidget } from "./expiring-soon-widget"
import { ObligationSummaryWidget } from "./obligation-summary-widget"
import { cn } from "@/lib/utils"
import type { AnalyticsSummary } from "@/app/api/analytics/summary/route"
import { useTranslations } from "next-intl"

// ─── Types ─────────────────────────────────────────────────────────────────

type DateRange = "30 Days" | "90 Days" | "12 Months" | "YTD"

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatTotalValue(byType: AnalyticsSummary["valueByType"]): string {
  const total = byType.reduce((s, d) => s + (d.totalValue ?? 0), 0)
  if (total === 0) return "$0"
  if (total >= 1_000_000) return `$${(total / 1_000_000).toFixed(1)}M`
  if (total >= 1_000) return `$${(total / 1_000).toFixed(0)}K`
  return `$${total}`
}

function computeApprovalRate(funnel: AnalyticsSummary["approvalFunnel"]): string {
  const denom = funnel.approved + funnel.rejected
  if (denom === 0) return "—"
  return `${Math.round((funnel.approved / denom) * 100)}%`
}

function getTotalContracts(byStatus: AnalyticsSummary["byStatus"]): number {
  return byStatus.reduce((s, d) => s + d.count, 0)
}

// ─── KPI Stat Card ────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  subtitle,
}: {
  title: string
  value: string | number
  subtitle?: string
}) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground mb-1">
        {title}
      </p>
      <p className="text-[28px] font-extrabold leading-none tabular-nums text-foreground">
        {value}
      </p>
      {subtitle && (
        <p className="text-[11.5px] text-muted-foreground mt-1.5">{subtitle}</p>
      )}
    </div>
  )
}

// ─── AnalyticsClient ──────────────────────────────────────────────────────

export function AnalyticsClient({ data }: { data: AnalyticsSummary }) {
  const t = useTranslations("analytics")
  const DATE_RANGES: DateRange[] = ["30 Days", "90 Days", "12 Months", "YTD"]
  const [dateRange, setDateRange] = useState<DateRange>("12 Months")

  const totalContracts = getTotalContracts(data.byStatus)
  const approvalRate = computeApprovalRate(data.approvalFunnel)
  const totalValue = formatTotalValue(data.valueByType)
  const expiringSoon30 = data.expiringSoon.next30

  return (
    <div className="flex flex-col h-full">
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-7 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("subtitle")}
          </p>
        </div>
        {/* Date range pills */}
        <div className="flex items-center gap-1">
          {DATE_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setDateRange(r)}
              className={cn(
                "rounded-[var(--radius)] px-3 py-1.5 text-xs font-medium transition-colors",
                dateRange === r
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-5 space-y-5">
        {/* ── Row 1: KPI cards ──────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-3">
          <KpiCard
            title={t("totalContractsKpi")}
            value={totalContracts}
          />
          <KpiCard
            title={t("expiringSoonKpi")}
            value={expiringSoon30}
            subtitle={t("next30Days")}
          />
          <KpiCard
            title={t("approvalRate")}
            value={approvalRate}
            subtitle={
              data.approvalFunnel.totalRequested > 0
                ? `${data.approvalFunnel.approved} of ${data.approvalFunnel.totalRequested} approved`
                : undefined
            }
          />
          <KpiCard
            title={t("totalValue")}
            value={totalValue}
            subtitle={
              data.valueByType.length > 0
                ? `across ${data.valueByType.reduce((s, d) => s + d.count, 0)} contracts`
                : undefined
            }
          />
        </div>

        {/* ── Row 2: Status donut + Monthly volume ──────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-[var(--radius)] border border-border bg-card p-5">
            <h3 className="text-[13px] font-semibold mb-4">{t("contractsByStatus")}</h3>
            <StatusDonutWidget data={data.byStatus} />
          </div>
          <div className="rounded-[var(--radius)] border border-border bg-card p-5">
            <h3 className="text-[13px] font-semibold mb-4">{t("monthlyVolume")}</h3>
            <MonthlyVolumeWidget data={data.monthlyVolume} />
          </div>
        </div>

        {/* ── Row 3: Value by type + Approval funnel ────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-[var(--radius)] border border-border bg-card p-5">
            <h3 className="text-[13px] font-semibold mb-4">
              {t("valueByType")}
            </h3>
            <ValueByTypeWidget data={data.valueByType} />
          </div>
          <div className="rounded-[var(--radius)] border border-border bg-card p-5">
            <h3 className="text-[13px] font-semibold mb-4">
              {t("approvalFunnel")}
            </h3>
            <ApprovalFunnelWidget data={data.approvalFunnel} />
          </div>
        </div>

        {/* ── Row 4: Expiring soon ───────────────────────────────────── */}
        <div className="rounded-[var(--radius)] border border-border bg-card p-5">
          <h3 className="text-[13px] font-semibold mb-4">{t("expiringContracts2")}</h3>
          <ExpiringSoonWidget data={data.expiringSoon} />
        </div>

        {/* ── Row 5: Obligations (graceful — hidden if unavailable) ──── */}
        {data.obligations !== null && (
          <div className="rounded-[var(--radius)] border border-border bg-card p-5">
            <h3 className="text-[13px] font-semibold mb-4">{t("obligations")}</h3>
            <ObligationSummaryWidget data={data.obligations} />
          </div>
        )}
      </div>
    </div>
  )
}

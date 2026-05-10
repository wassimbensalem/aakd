"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { MonthlyVolumeWidget } from "./monthly-volume-widget"
import { StatusDonutWidget } from "./status-donut-widget"
import { cn } from "@/lib/utils"
import type { AnalyticsSummary } from "@/app/api/analytics/summary/route"

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
  trend,
  trendLabel,
}: {
  title: string
  value: string | number
  trend: "up" | "down"
  trendLabel: string
}) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground mb-1">
        {title}
      </p>
      <p className="text-[28px] font-extrabold leading-none tabular-nums text-foreground">
        {value}
      </p>
      <p className="text-[11.5px] text-muted-foreground mt-1.5 flex items-center gap-1">
        <span
          className={cn(
            "text-xs font-bold",
            trend === "up" ? "text-success" : "text-success",
          )}
        >
          {trend === "up" ? "↑" : "↓"}
        </span>
        {trendLabel}
      </p>
    </div>
  )
}

// ─── Dept Bar Chart (static) ──────────────────────────────────────────────

const DEPT_DATA = [
  { label: "Sales",       value: 2.4, display: "$2.4M" },
  { label: "Legal",       value: 1.8, display: "$1.8M" },
  { label: "Engineering", value: 0.9, display: "$0.9M" },
  { label: "HR",          value: 0.6, display: "$0.6M" },
  { label: "Finance",     value: 0.4, display: "$0.4M" },
]

function DeptBarChart() {
  const max = DEPT_DATA[0].value
  return (
    <div className="space-y-3">
      {DEPT_DATA.map((d) => (
        <div key={d.label} className="flex items-center gap-3 text-xs">
          <span className="w-24 shrink-0 text-muted-foreground">{d.label}</span>
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary opacity-75 rounded-full"
              style={{ width: `${(d.value / max) * 100}%` }}
            />
          </div>
          <span className="w-12 text-right tabular-nums font-medium text-foreground/80">
            {d.display}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Cycle Time Chart (static) ───────────────────────────────────────────

const CYCLE_DATA = [
  { label: "NDA",        days: 3 },
  { label: "SaaS",       days: 8 },
  { label: "MSA",        days: 14 },
  { label: "Employment", days: 5 },
  { label: "Vendor",     days: 11 },
]

function CycleBarChart() {
  const max = Math.max(...CYCLE_DATA.map((d) => d.days))
  return (
    <div className="space-y-3">
      {CYCLE_DATA.map((d) => (
        <div key={d.label} className="flex items-center gap-3 text-xs">
          <span className="w-24 shrink-0 text-muted-foreground">{d.label}</span>
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full opacity-80",
                d.days > 10 ? "bg-warning" : "bg-primary",
              )}
              style={{ width: `${(d.days / max) * 100}%` }}
            />
          </div>
          <span className="w-8 text-right tabular-nums font-medium text-foreground/80">
            {d.days}d
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Top Counterparties (static) ─────────────────────────────────────────

const COUNTERPARTIES = [
  { name: "Acme Corp",         contracts: 12, value: "$540K",  cycle: "5.2 days",  status: "Active",   statusOk: true },
  { name: "Global Partners",   contracts: 8,  value: "$960K",  cycle: "9.1 days",  status: "Active",   statusOk: true },
  { name: "TechVenture Inc",   contracts: 6,  value: "$220K",  cycle: "4.8 days",  status: "Active",   statusOk: true },
  { name: "CloudNine",         contracts: 5,  value: "$335K",  cycle: "12.3 days", status: "Expiring", statusOk: false },
  { name: "DataFlow Corp",     contracts: 4,  value: "$128K",  cycle: "6.7 days",  status: "Active",   statusOk: true },
]

function CounterpartiesTable() {
  return (
    <div className="rounded-[var(--radius)] border border-border overflow-hidden bg-card">
      <table className="w-full border-collapse" style={{ fontSize: "12.5px" }}>
        <thead>
          <tr>
            {["Counterparty", "Contracts", "Total Value", "Avg. Cycle", "Status"].map((h) => (
              <th
                key={h}
                className="px-4 py-[7px] text-left text-[10.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground bg-muted border-b border-border"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COUNTERPARTIES.map((r, i) => (
            <tr
              key={i}
              className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
            >
              <td className="px-4 py-2.5 font-medium">{r.name}</td>
              <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{r.contracts}</td>
              <td className="px-4 py-2.5 tabular-nums">{r.value}</td>
              <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{r.cycle}</td>
              <td className="px-4 py-2.5">
                {r.statusOk ? (
                  <span className="inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success ring-1 ring-success/30">
                    Active
                  </span>
                ) : (
                  <Badge variant="destructive">Expiring</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── AnalyticsClient ──────────────────────────────────────────────────────

export function AnalyticsClient({ data }: { data: AnalyticsSummary }) {
  const DATE_RANGES: DateRange[] = ["30 Days", "90 Days", "12 Months", "YTD"]
  const [dateRange, setDateRange] = useState<DateRange>("12 Months")

  const totalContracts = getTotalContracts(data.byStatus)
  const approvalRate = computeApprovalRate(data.approvalFunnel)
  const totalValue = formatTotalValue(data.valueByType)

  return (
    <div className="flex flex-col h-full">
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-7 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-xl font-semibold">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Contract performance metrics and trends.
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
            title="Total Contracts"
            value={totalContracts}
            trend="up"
            trendLabel="23% vs prior period"
          />
          <KpiCard
            title="Avg. Cycle Time"
            value="7.2 days"
            trend="up"
            trendLabel="1.5 days improvement"
          />
          <KpiCard
            title="Approval Rate"
            value={approvalRate}
            trend="up"
            trendLabel="2% from last quarter"
          />
          <KpiCard
            title="Total Value"
            value={totalValue}
            trend="up"
            trendLabel="$890K vs prior period"
          />
        </div>

        {/* ── Row 2: Status donut + Monthly volume ──────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-[var(--radius)] border border-border bg-card p-5">
            <h3 className="text-[13px] font-semibold mb-4">Contracts by Status</h3>
            <StatusDonutWidget data={data.byStatus} />
          </div>
          <div className="rounded-[var(--radius)] border border-border bg-card p-5">
            <h3 className="text-[13px] font-semibold mb-4">Monthly Contract Volume</h3>
            <MonthlyVolumeWidget data={data.monthlyVolume} />
          </div>
        </div>

        {/* ── Row 3: Dept value + Cycle time ────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-[var(--radius)] border border-border bg-card p-5">
            <h3 className="text-[13px] font-semibold mb-4">
              Contract Value by Department
            </h3>
            <DeptBarChart />
          </div>
          <div className="rounded-[var(--radius)] border border-border bg-card p-5">
            <h3 className="text-[13px] font-semibold mb-4">
              Avg. Cycle Time by Type
            </h3>
            <CycleBarChart />
          </div>
        </div>

        {/* ── Row 4: Top counterparties ──────────────────────────────── */}
        <div>
          <h3 className="text-[13px] font-semibold mb-3">Top Counterparties</h3>
          <CounterpartiesTable />
        </div>
      </div>
    </div>
  )
}

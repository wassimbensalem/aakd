"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Bell, Plus, ArrowUpRight, FileText } from "lucide-react"
import { useSession } from "@/lib/auth/client"
import { ContractStatusBadge } from "@/components/contract-status-badge"
import { Skeleton } from "@/components/ui/skeleton"
import type { Contract } from "@/lib/types"
import type { AnalyticsSummary } from "@/app/api/analytics/summary/route"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGreeting(hour: number) {
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

function getInitials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—"
  try {
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" })
  } catch { return "—" }
}

function formatValue(value: number | null | undefined, currency = "USD"): string {
  if (!value) return "—"
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency,
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value)
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ title, value, sub, loading }: { title: string; value: number; sub: string; loading?: boolean }) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground mb-1">{title}</p>
      {loading
        ? <Skeleton className="h-8 w-16 my-0.5" />
        : <p className="text-[28px] font-extrabold leading-none tabular-nums text-foreground">{value}</p>
      }
      <p className="text-[11.5px] text-muted-foreground mt-1.5">{sub}</p>
    </div>
  )
}

// ─── Renewal bar chart ────────────────────────────────────────────────────────

function RenewalChart({ monthlyVolume }: { monthlyVolume: Array<{ month: string; count: number }> }) {
  const slice = monthlyVolume.slice(-8)
  if (slice.length === 0) {
    return <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">No data yet</div>
  }
  const max = Math.max(...slice.map((d) => d.count), 1)
  const barW = 28, gap = 10, chartH = 100

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${slice.length * (barW + gap) - gap} ${chartH + 28}`} className="block">
        {slice.map((d, i) => {
          const barH = Math.max(4, (d.count / max) * chartH)
          const x = i * (barW + gap)
          let label = d.month
          try { label = new Date(d.month + "-01").toLocaleDateString("en-US", { month: "short" }) } catch {}
          const isHigh = d.count === max && d.count > 0
          return (
            <g key={i}>
              <rect x={x} y={chartH - barH} width={barW} height={barH} rx={3}
                fill={isHigh ? "hsl(38 85% 52%)" : "hsl(148 58% 30%)"} opacity={isHigh ? 1 : 0.75} />
              {d.count > 0 && (
                <text x={x + barW / 2} y={chartH - barH - 5} textAnchor="middle"
                  fontSize={10} fontWeight={600} fill="hsl(215 35% 11%)" className="dark:fill-[hsl(210_25%_96%)]">
                  {d.count}
                </text>
              )}
              <text x={x + barW / 2} y={chartH + 16} textAnchor="middle" fontSize={10} fill="hsl(215 8% 45%)">
                {label}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="flex gap-4 mt-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: "hsl(148 58% 30%)", opacity: 0.75 }} />
          Standard
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: "hsl(38 85% 52%)" }} />
          High volume
        </span>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: session } = useSession()
  const [analytics, setAnalytics]     = useState<AnalyticsSummary | null>(null)
  const [contracts, setContracts]     = useState<Contract[]>([])
  const [loading, setLoading]         = useState(true)

  // Fetch on every mount — no Next.js cache layer involved, always fresh.
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    Promise.all([
      fetch("/api/analytics/summary", { credentials: "include" }).then((r) => r.ok ? r.json() : null),
      fetch("/api/contracts?limit=5",  { credentials: "include" }).then((r) => r.ok ? r.json() : null),
    ]).then(([analyticsData, contractsData]) => {
      if (cancelled) return
      setAnalytics(analyticsData ?? null)
      setContracts(contractsData?.contracts ?? [])
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, []) // mounts fresh on every navigation

  const hour       = new Date().getHours()
  const greeting   = getGreeting(hour)
  const fullName   = session?.user?.name ?? session?.user?.email ?? "there"
  const firstName  = fullName.split(" ")[0]

  const activeCount   = analytics?.byStatus.find((s) => s.status === "ACTIVE")?.count ?? 0
  const expiringCount = analytics?.expiringSoon.next30 ?? 0
  const pendingCount  = analytics?.approvalFunnel.pending ?? 0

  return (
    <div className="flex flex-col h-full">
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-7 py-4 border-b border-border shrink-0">
        <div>
          {loading
            ? <Skeleton className="h-6 w-48 mb-1" />
            : <h1 className="text-[18px] font-bold tracking-tight leading-snug">{greeting}, {firstName}</h1>
          }
          <p className="text-[12.5px] text-muted-foreground mt-0.5">
            Here&apos;s what&apos;s happening with your contracts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/settings/notifications"
            className="flex h-[34px] w-[34px] items-center justify-center rounded-[var(--radius)] border border-border bg-background text-muted-foreground transition-colors hover:text-foreground"
          >
            <Bell className="h-[15px] w-[15px]" />
          </Link>
          <Link
            href="/contracts/new"
            className="inline-flex items-center gap-1.5 h-[34px] px-3 text-[13px] font-medium rounded-[var(--radius)] bg-primary text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            New Contract
          </Link>
        </div>
      </div>

      {/* ── Stat cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3 px-7 pt-4 shrink-0">
        <StatCard title="Active Contracts"  value={activeCount}   sub="Total in portfolio"  loading={loading} />
        <StatCard title="Expiring Soon"     value={expiringCount} sub="Within 30 days"      loading={loading} />
        <StatCard title="Pending Approvals" value={pendingCount}  sub="Awaiting review"     loading={loading} />
      </div>

      {/* ── Main grid ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-[1fr_340px] gap-4 px-7 py-4 flex-1 min-h-0">
        {/* Recent contracts table */}
        <div className="flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-[14px] font-semibold">Recent Contracts</h2>
            <Link href="/contracts" className="flex items-center gap-1 text-[12px] font-medium text-primary hover:opacity-80 transition-opacity">
              View all <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>

          {loading ? (
            <div className="rounded-[var(--radius)] border border-border overflow-hidden bg-card">
              <table className="w-full border-collapse" style={{ fontSize: "12.5px" }}>
                <thead>
                  <tr>
                    {["Contract", "Counterparty", "Value", "Due", "Status", ""].map((h, i) => (
                      <th key={i} className="px-3 py-[7px] text-left text-[10.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground bg-muted border-b border-border">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-3 py-2.5"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : contracts.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-[var(--radius)] border border-dashed border-border bg-muted/20 py-14 gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius)] bg-primary/10">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">No contracts yet</p>
                <p className="text-xs text-muted-foreground mt-0.5">Upload your first contract to get started</p>
              </div>
              <Link href="/contracts/new" className="inline-flex items-center gap-1.5 h-8 px-3 text-[0.8rem] font-medium rounded-[var(--radius)] bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
                <Plus className="h-3.5 w-3.5" /> Upload contract
              </Link>
            </div>
          ) : (
            <div className="rounded-[var(--radius)] border border-border overflow-hidden bg-card">
              <table className="w-full border-collapse" style={{ fontSize: "12.5px" }}>
                <thead>
                  <tr>
                    {["Contract", "Counterparty", "Value", "Due", "Status", ""].map((h, i) => (
                      <th key={i} className="px-3 py-[7px] text-left text-[10.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground bg-muted border-b border-border">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors cursor-pointer">
                      <td className="px-3 py-2.5 font-medium">
                        <Link href={`/contracts/${c.id}`} className="hover:text-primary transition-colors">{c.title}</Link>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{c.counterpartyName ?? "—"}</td>
                      <td className="px-3 py-2.5 tabular-nums">{formatValue(c.value, c.currency ?? undefined)}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{formatDate(c.endDate)}</td>
                      <td className="px-3 py-2.5"><ContractStatusBadge status={c.status} /></td>
                      <td className="px-3 py-2.5">
                        {c.owner && (
                          <div title={c.owner.name || c.owner.email}
                            className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-primary/12 text-primary shrink-0"
                            style={{ fontSize: "9px", fontWeight: 700 }}>
                            {getInitials(c.owner.name || c.owner.email)}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Renewal timeline */}
        <div className="rounded-[var(--radius)] border border-border bg-card px-5 py-4 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[13px] font-semibold">Renewal Timeline</h3>
            <span className="text-[11px] text-muted-foreground">
              Last {(analytics?.monthlyVolume ?? []).slice(-8).length} months
            </span>
          </div>
          {loading
            ? <Skeleton className="h-32 w-full" />
            : <RenewalChart monthlyVolume={analytics?.monthlyVolume ?? []} />
          }
        </div>
      </div>
    </div>
  )
}

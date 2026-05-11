"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { Search, Target } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { Obligation, ObligationStatus, ObligationPriority } from "@/components/obligations/types"

// ─── Types ────────────────────────────────────────────────────────────────────

type FlatObligation = Obligation & {
  contractTitle: string
  contractCounterparty: string | null
  contract: { id: string; title: string; counterpartyName: string | null }
}

type FilterKey = "All" | "Overdue" | "Due Soon" | "Upcoming" | "Completed"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function isWithinDays(dateStr: string, days: number): boolean {
  const d = new Date(dateStr)
  const now = new Date()
  const cutoff = new Date(now.getTime() + days * 86_400_000)
  return d > now && d <= cutoff
}

function isOverdue(dateStr: string, status: ObligationStatus): boolean {
  if (status === "OVERDUE") return true
  if (status === "PENDING" || status === "IN_PROGRESS") {
    return new Date(dateStr) < new Date()
  }
  return false
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  } catch {
    return "—"
  }
}

function isThisQuarter(dateStr: string | null): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  const now = new Date()
  const qStart = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1))
  const qEnd = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3 + 3, 1))
  return d >= qStart && d < qEnd
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  sub,
  trend,
}: {
  title: string
  value: number
  sub: string
  trend?: "up" | "down"
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
        {trend === "up" && <span className="text-success text-xs">↑</span>}
        {trend === "down" && <span className="text-destructive text-xs">↓</span>}
        {sub}
      </p>
    </div>
  )
}

// ─── Priority Badge ───────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: ObligationPriority }) {
  if (priority === "HIGH") return <Badge variant="destructive">High</Badge>
  if (priority === "MEDIUM") {
    return (
      <span className="inline-flex items-center rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning ring-1 ring-warning/30">
        Medium
      </span>
    )
  }
  return <Badge variant="secondary">Low</Badge>
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({
  status,
  dueDate,
}: {
  status: ObligationStatus
  dueDate: string
}) {
  if (status === "OVERDUE") return <Badge variant="destructive">Overdue</Badge>
  if (status === "COMPLETED") {
    return (
      <span className="inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success ring-1 ring-success/30">
        Completed
      </span>
    )
  }
  // PENDING / IN_PROGRESS — check if due soon (within 7 days)
  if (isWithinDays(dueDate, 7)) {
    return (
      <span className="inline-flex items-center rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning ring-1 ring-warning/30">
        Due Soon
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-info/15 px-2 py-0.5 text-xs font-medium text-info ring-1 ring-info/30">
      Pending
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ObligationsPage() {
  const [obligations, setObligations] = useState<FlatObligation[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [activeFilter, setActiveFilter] = useState<FilterKey>("All")

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/obligations")
        if (!res.ok) throw new Error("obligations")
        const data = await res.json()
        const list: Array<Obligation & { contract: { id: string; title: string; counterpartyName: string | null } }> =
          data.obligations ?? []
        const flat: FlatObligation[] = list.map((o) => ({
          ...o,
          contractTitle: o.contract.title,
          contractCounterparty: o.contract.counterpartyName,
        }))
        setObligations(flat)
      } catch {
        toast.error("Failed to load obligations")
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const now = new Date()
  const d7 = new Date(now.getTime() + 7 * 86_400_000)

  const stats = useMemo(() => {
    const overdue = obligations.filter((o) => o.status === "OVERDUE").length
    const dueSoon = obligations.filter(
      (o) =>
        (o.status === "PENDING" || o.status === "IN_PROGRESS") &&
        isWithinDays(o.dueDate, 7),
    ).length
    const upcoming = obligations.filter(
      (o) =>
        (o.status === "PENDING" || o.status === "IN_PROGRESS") &&
        new Date(o.dueDate) > d7 &&
        new Date(o.dueDate) <= new Date(now.getTime() + 60 * 86_400_000),
    ).length
    const completed = obligations.filter(
      (o) => o.status === "COMPLETED" && isThisQuarter(o.completedAt),
    ).length
    return { overdue, dueSoon, upcoming, completed }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obligations])

  const filtered = useMemo(() => {
    let list = obligations

    // Filter
    if (activeFilter === "Overdue") {
      list = list.filter((o) => o.status === "OVERDUE")
    } else if (activeFilter === "Due Soon") {
      list = list.filter(
        (o) =>
          (o.status === "PENDING" || o.status === "IN_PROGRESS") &&
          isWithinDays(o.dueDate, 7),
      )
    } else if (activeFilter === "Upcoming") {
      list = list.filter(
        (o) =>
          (o.status === "PENDING" || o.status === "IN_PROGRESS") &&
          new Date(o.dueDate) > d7 &&
          new Date(o.dueDate) <= new Date(now.getTime() + 60 * 86_400_000),
      )
    } else if (activeFilter === "Completed") {
      list = list.filter((o) => o.status === "COMPLETED")
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (o) =>
          o.title.toLowerCase().includes(q) ||
          o.contractTitle.toLowerCase().includes(q) ||
          (o.assignee?.name ?? "").toLowerCase().includes(q),
      )
    }

    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obligations, activeFilter, search])

  const FILTERS: FilterKey[] = ["All", "Overdue", "Due Soon", "Upcoming", "Completed"]

  return (
    <div className="flex flex-col h-full">
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-7 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-xl font-semibold">Obligations</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track and manage contractual obligations and deadlines.
          </p>
        </div>
        <Link
          href="/contracts"
          className="inline-flex items-center gap-1.5 h-[34px] px-3 text-[13px] font-medium rounded-[var(--radius)] border border-border bg-background text-foreground transition-colors hover:bg-muted"
        >
          Go to Contracts
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-5 space-y-5">
        {/* ── Stat cards ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-3">
          <StatCard
            title="Overdue"
            value={stats.overdue}
            sub="Requires immediate attention"
            trend="down"
          />
          <StatCard
            title="Due This Week"
            value={stats.dueSoon}
            sub="Action needed soon"
          />
          <StatCard
            title="Upcoming"
            value={stats.upcoming}
            sub="Next 60 days"
          />
          <StatCard
            title="Completed"
            value={stats.completed}
            sub="This quarter"
            trend="up"
          />
        </div>

        {/* ── Filters row ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search obligations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-[6px] text-sm bg-background border border-border rounded-[var(--radius)] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setActiveFilter(f)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  activeFilter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* ── Table ────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="rounded-[var(--radius)] border border-border bg-card p-10 text-center">
            <p className="text-sm text-muted-foreground">Loading obligations...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-dashed border-border bg-muted/20">
            <EmptyState
              icon={Target}
              title="No obligations"
              description={
                search || activeFilter !== "All"
                  ? "Try adjusting your search or filter."
                  : "Obligations linked to your contracts will appear here."
              }
            />
          </div>
        ) : (
          <div className="rounded-[var(--radius)] border border-border overflow-hidden bg-card">
            <table className="w-full border-collapse" style={{ fontSize: "12.5px" }}>
              <thead>
                <tr>
                  {["Obligation", "Contract", "Assignee", "Due Date", "Priority", "Status"].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-3 py-[7px] text-left text-[10.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground bg-muted border-b border-border"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((ob) => {
                  const overdue = isOverdue(ob.dueDate, ob.status)
                  const assigneeName = ob.assignee?.name ?? null
                  const assigneeInitials = assigneeName
                    ? getInitials(assigneeName)
                    : ob.assignee?.id
                    ? ob.assignee.id.slice(0, 2).toUpperCase()
                    : null

                  return (
                    <tr
                      key={ob.id}
                      className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                    >
                      {/* Obligation */}
                      <td className="px-3 py-2.5 font-medium max-w-[220px]">
                        <span className="truncate block">{ob.title}</span>
                      </td>
                      {/* Contract */}
                      <td className="px-3 py-2.5 max-w-[180px]">
                        <span className="block truncate font-medium">
                          {ob.contractTitle}
                        </span>
                        {ob.contractCounterparty && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {ob.contractCounterparty}
                          </span>
                        )}
                      </td>
                      {/* Assignee */}
                      <td className="px-3 py-2.5">
                        {assigneeInitials ? (
                          <div className="flex items-center gap-2">
                            {ob.assignee?.image ? (
                              <img
                                src={ob.assignee.image}
                                className="w-full h-full object-cover rounded-full"
                                alt={assigneeName ?? ""}
                                style={{ width: "24px", height: "24px" }}
                              />
                            ) : (
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
                                <span style={{ fontSize: "9px", fontWeight: 700 }}>
                                  {assigneeInitials}
                                </span>
                              </div>
                            )}
                            <span className="text-foreground/80">
                              {assigneeName ?? "—"}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      {/* Due Date */}
                      <td
                        className={cn(
                          "px-3 py-2.5 tabular-nums",
                          overdue
                            ? "text-destructive font-semibold"
                            : "text-muted-foreground",
                        )}
                      >
                        {formatDate(ob.dueDate)}
                      </td>
                      {/* Priority */}
                      <td className="px-3 py-2.5">
                        <PriorityBadge priority={ob.priority} />
                      </td>
                      {/* Status */}
                      <td className="px-3 py-2.5">
                        <StatusBadge status={ob.status} dueDate={ob.dueDate} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

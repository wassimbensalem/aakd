"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { Search, Target, CalendarDays, User, Flag, BookOpen, Bell, Square, CheckSquare, FileText, X, Pencil, Trash2, Loader2 } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { useSession } from "@/lib/auth/client"
import { cn } from "@/lib/utils"
import type { Obligation, ObligationStatus, ObligationPriority } from "@/components/obligations/types"
import type { OrgMember } from "@/lib/types"
import { ObligationSheet } from "@/components/obligations/obligation-sheet"
import { useTranslations } from "next-intl"

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

// ─── Obligation Detail Sheet ──────────────────────────────────────────────────

function ObligationDetailSheet({
  obligation,
  onClose,
  onEdit,
  canDelete = false,
  onDelete,
}: {
  obligation: FlatObligation | null
  onClose: () => void
  onEdit: () => void
  canDelete?: boolean
  onDelete?: () => void
}) {
  const ob = obligation
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!ob || !onDelete) return
    setDeleting(true)
    try {
      const res = await fetch(
        `/api/contracts/${ob.contractId}/obligations/${ob.id}`,
        { method: "DELETE" },
      )
      if (!res.ok) throw new Error()
      onDelete()
      toast.success("Obligation deleted")
    } catch {
      toast.error("Failed to delete obligation")
      setDeleting(false)
    }
  }

  if (!ob) return null

  const overdue = isOverdue(ob.dueDate, ob.status)
  const assigneeName = ob.assignee?.name ?? null
  const assigneeInitials = assigneeName
    ? getInitials(assigneeName)
    : ob.assignee?.id
    ? ob.assignee.id.slice(0, 2).toUpperCase()
    : null

  return (
    <Sheet open={!!obligation} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side="right" className="sm:max-w-md flex flex-col gap-0 p-0">
        {/* Header */}
        <div className="flex flex-col gap-3 px-5 pt-5 pb-4 border-b border-border">
          <div className="flex items-start justify-between gap-2">
            <p className="text-lg font-semibold leading-snug">{ob.title}</p>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 -mt-1 -mr-1"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={ob.status} dueDate={ob.dueDate} />
            <PriorityBadge priority={ob.priority} />
          </div>
        </div>

        {/* Detail rows */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Contract */}
          <div className="flex items-start gap-3">
            <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0">
              <Link
                href={`/contracts/${ob.contract.id}?tab=obligations`}
                className="text-sm font-medium text-primary hover:underline truncate block"
              >
                {ob.contractTitle}
              </Link>
              {ob.contractCounterparty && (
                <span className="text-xs text-muted-foreground">{ob.contractCounterparty}</span>
              )}
            </div>
          </div>

          {/* Due date */}
          <div className="flex items-start gap-3">
            <CalendarDays className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <span
              className={cn(
                "text-sm tabular-nums",
                overdue ? "text-destructive font-semibold" : "text-foreground",
              )}
            >
              {formatDate(ob.dueDate)}
              {overdue && (
                <span className="ml-1.5 text-xs font-normal text-destructive">
                  (Overdue)
                </span>
              )}
            </span>
          </div>

          {/* Assignee */}
          <div className="flex items-start gap-3">
            <User className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            {assigneeInitials ? (
              <div className="flex items-center gap-2">
                {ob.assignee?.image ? (
                  <img
                    src={ob.assignee.image}
                    className="w-6 h-6 rounded-full object-cover"
                    alt={assigneeName ?? ""}
                  />
                ) : (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
                    <span style={{ fontSize: "9px", fontWeight: 700 }}>
                      {assigneeInitials}
                    </span>
                  </div>
                )}
                <span className="text-sm text-foreground">{assigneeName}</span>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Unassigned</span>
            )}
          </div>

          {/* Priority */}
          <div className="flex items-start gap-3">
            <Flag className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <PriorityBadge priority={ob.priority} />
          </div>

          {/* Clause reference */}
          <div className="flex items-start gap-3">
            <BookOpen className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <span className="text-sm text-foreground">
              {ob.clauseReference ?? "—"}
            </span>
          </div>

          {/* Reminder — read-only; edit via Edit Obligation */}
          <div className="flex items-start gap-3">
            <Bell className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex flex-col gap-1 min-w-0">
              <span className="text-sm text-foreground">
                {ob.reminderDays} day{ob.reminderDays === 1 ? "" : "s"} before due
              </span>
              {ob.reminderSentAt && (
                <p className="text-xs text-muted-foreground">
                  Reminder sent{" "}
                  {new Date(ob.reminderSentAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              )}
            </div>
          </div>

          {/* Description */}
          {ob.description && (
            <div className="pt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                Description
              </p>
              <p className="text-sm text-foreground whitespace-pre-wrap">{ob.description}</p>
            </div>
          )}

          {/* Sub-tasks */}
          {ob.subTasks.length > 0 && (
            <div className="pt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
                Sub-tasks
                <span className="inline-flex items-center justify-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {ob.subTasks.length}
                </span>
              </p>
              <ul className="space-y-1.5">
                {ob.subTasks.map((st) => (
                  <li key={st.id} className="flex items-center gap-2">
                    {st.isCompleted ? (
                      <CheckSquare className="h-4 w-4 text-success shrink-0" />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span
                      className={cn(
                        "text-sm",
                        st.isCompleted
                          ? "line-through text-muted-foreground"
                          : "text-foreground",
                      )}
                    >
                      {st.title}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-4 space-y-3">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="flex-1 gap-1.5"
              onClick={onEdit}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit Obligation
            </Button>
            <Link
              href={`/contracts/${ob.contract.id}?tab=obligations`}
              className="flex items-center justify-center h-9 px-3 rounded-[var(--radius)] border border-border bg-background text-sm font-medium hover:bg-muted transition-colors whitespace-nowrap"
            >
              Open in Contract →
            </Link>
            {canDelete && (
              <Button
                variant="destructive"
                size="icon"
                disabled={deleting}
                onClick={handleDelete}
                title="Delete obligation"
              >
                {deleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Created by {ob.createdBy.name} · {formatDate(ob.createdAt)}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ObligationsPage() {
  const { data: session } = useSession()
  const [obligations, setObligations] = useState<FlatObligation[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [activeFilter, setActiveFilter] = useState<FilterKey>("All")
  const [selected, setSelected] = useState<FlatObligation | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [obRes, memRes] = await Promise.all([
          fetch("/api/obligations"),
          fetch("/api/org/members"),
        ])
        if (!obRes.ok) throw new Error("obligations")
        const data = await obRes.json()
        const list: Array<Obligation & { contract: { id: string; title: string; counterpartyName: string | null } }> =
          data.obligations ?? []
        const flat: FlatObligation[] = list.map((o) => ({
          ...o,
          contractTitle: o.contract.title,
          contractCounterparty: o.contract.counterpartyName,
        }))
        setObligations(flat)
        if (memRes.ok) setMembers(await memRes.json())
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

  const canDelete = ["owner", "admin", "legal"].includes(
    members.find((m) => m.userId === session?.user?.id)?.role ?? "",
  )

  // Single-row delete (called from detail sheet)
  function handleDeleteSelected() {
    if (!selected) return
    setObligations((prev) => prev.filter((o) => o.id !== selected.id))
    setCheckedIds((prev) => { const s = new Set(prev); s.delete(selected.id); return s })
    setSelected(null)
  }

  // Bulk delete
  async function handleBulkDelete() {
    if (checkedIds.size === 0 || bulkDeleting) return
    setBulkDeleting(true)
    const ids = Array.from(checkedIds)
    const targets = obligations.filter((o) => ids.includes(o.id))
    const results = await Promise.allSettled(
      targets.map((o) =>
        fetch(`/api/contracts/${o.contractId}/obligations/${o.id}`, {
          method: "DELETE",
        }),
      ),
    )
    const failed = results.filter(
      (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok),
    ).length
    const succeeded = ids.length - failed
    if (succeeded > 0) {
      const deletedIds = new Set(
        targets
          .filter((_, i) => {
            const r = results[i]
            return r.status === "fulfilled" && r.value.ok
          })
          .map((o) => o.id),
      )
      setObligations((prev) => prev.filter((o) => !deletedIds.has(o.id)))
      setCheckedIds((prev) => { const s = new Set(prev); deletedIds.forEach((id) => s.delete(id)); return s })
      if (selected && deletedIds.has(selected.id)) setSelected(null)
      toast.success(`${succeeded} obligation${succeeded === 1 ? "" : "s"} deleted`)
    }
    if (failed > 0) toast.error(`${failed} deletion${failed === 1 ? "" : "s"} failed`)
    setBulkDeleting(false)
  }

  // Checkbox helpers
  const allFilteredIds = filtered.map((o) => o.id)
  const allChecked = allFilteredIds.length > 0 && allFilteredIds.every((id) => checkedIds.has(id))
  const someChecked = allFilteredIds.some((id) => checkedIds.has(id))

  function toggleAll() {
    if (allChecked) {
      setCheckedIds((prev) => {
        const s = new Set(prev)
        allFilteredIds.forEach((id) => s.delete(id))
        return s
      })
    } else {
      setCheckedIds((prev) => new Set(Array.from(prev).concat(allFilteredIds)))
    }
  }

  function toggleOne(id: string) {
    setCheckedIds((prev) => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  const t = useTranslations("obligations")
  const FILTERS: Array<{ key: FilterKey; label: string }> = [
    { key: "All",       label: t("filterAll") },
    { key: "Overdue",   label: t("filterOverdue") },
    { key: "Due Soon",  label: t("filterDueSoon") },
    { key: "Upcoming",  label: t("filterUpcoming") },
    { key: "Completed", label: t("filterCompleted") },
  ]

  return (
    <div className="relative flex flex-col h-full">
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-7 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("subtitle")}
          </p>
        </div>
        <Link
          href="/contracts"
          className="inline-flex items-center gap-1.5 h-[34px] px-3 text-[13px] font-medium rounded-[var(--radius)] border border-border bg-background text-foreground transition-colors hover:bg-muted"
        >
          {t("goToContracts")}
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-5 space-y-5">
        {/* ── Stat cards ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-3">
          <StatCard
            title={t("overdue")}
            value={stats.overdue}
            sub={t("overdueRequires")}
            trend="down"
          />
          <StatCard
            title={t("dueThisWeek")}
            value={stats.dueSoon}
            sub={t("actionNeeded")}
          />
          <StatCard
            title={t("upcoming")}
            value={stats.upcoming}
            sub={t("next60Days")}
          />
          <StatCard
            title={t("completed")}
            value={stats.completed}
            sub={t("thisQuarter")}
            trend="up"
          />
        </div>

        {/* ── Filters row ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-[6px] text-sm bg-background border border-border rounded-[var(--radius)] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setActiveFilter(f.key)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  activeFilter === f.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Table ────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="rounded-[var(--radius)] border border-border bg-card p-10 text-center">
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-dashed border-border bg-muted/20">
            <EmptyState
              icon={Target}
              title={t("noObligations")}
              description={
                search || activeFilter !== "All"
                  ? t("noObligationsFilter")
                  : t("noObligationsDesc")
              }
            />
          </div>
        ) : (
          <div className="rounded-[var(--radius)] border border-border overflow-hidden bg-card">
            <table className="w-full border-collapse" style={{ fontSize: "12.5px" }}>
              <thead>
                <tr>
                  {canDelete && (
                    <th className="w-9 px-3 py-[7px] bg-muted border-b border-border">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked }}
                        onChange={toggleAll}
                        className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer"
                        aria-label="Select all"
                      />
                    </th>
                  )}
                  {[t("tableObligation"), t("tableContract"), t("tableAssignee"), t("tableDueDate"), t("tablePriority"), t("tableStatus")].map(
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
                      className={cn(
                        "border-b border-border last:border-0 hover:bg-muted/40 transition-colors cursor-pointer",
                        checkedIds.has(ob.id) && "bg-primary/5",
                      )}
                      onClick={() => setSelected(ob)}
                    >
                      {canDelete && (
                        <td
                          className="w-9 px-3 py-2.5"
                          onClick={(e) => { e.stopPropagation(); toggleOne(ob.id) }}
                        >
                          <input
                            type="checkbox"
                            checked={checkedIds.has(ob.id)}
                            onChange={() => toggleOne(ob.id)}
                            className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer"
                            aria-label={`Select ${ob.title}`}
                          />
                        </td>
                      )}
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

      {/* ── Bulk action bar ─────────────────────────────────────────── */}
      {canDelete && checkedIds.size > 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-[var(--radius)] border border-border bg-card shadow-lg px-4 py-2.5">
          <span className="text-sm font-medium text-foreground tabular-nums">
            {checkedIds.size} selected
          </span>
          <div className="h-4 w-px bg-border" />
          <Button
            variant="destructive"
            size="sm"
            disabled={bulkDeleting}
            onClick={handleBulkDelete}
            className="gap-1.5"
          >
            {bulkDeleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Delete {checkedIds.size === 1 ? "obligation" : `${checkedIds.size} obligations`}
          </Button>
          <button
            type="button"
            onClick={() => setCheckedIds(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      <ObligationDetailSheet
        obligation={selected}
        onClose={() => setSelected(null)}
        onEdit={() => {
          setSelected((prev) => prev) // keep selected
          setEditOpen(true)
        }}
        canDelete={canDelete}
        onDelete={handleDeleteSelected}
      />

      {selected && (
        <ObligationSheet
          open={editOpen}
          onOpenChange={(open) => {
            setEditOpen(open)
          }}
          contractId={selected.contractId}
          obligation={selected}
          members={members}
          onSaved={(saved) => {
            const updated: FlatObligation = {
              ...selected,
              ...saved,
              contractTitle: selected.contractTitle,
              contractCounterparty: selected.contractCounterparty,
              contract: selected.contract,
            }
            setObligations((prev) =>
              prev.map((o) => (o.id === updated.id ? updated : o)),
            )
            setSelected(updated)
            setEditOpen(false)
          }}
        />
      )}
    </div>
  )
}

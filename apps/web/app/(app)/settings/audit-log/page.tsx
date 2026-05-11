"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import {
  Download, FileText, Upload, CheckCircle, RefreshCw,
  Key, UserPlus, XCircle, Trash2, PenLine, Eye,
  Bell, Tag, ChevronLeft, ChevronRight, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

// ─── Activity mapping ─────────────────────────────────────────────────────────

type Category = "green" | "amber" | "red" | "blue"

interface ActionMeta {
  label: string
  category: Category
  Icon: React.ElementType
}

const ACTION_META: Record<string, ActionMeta> = {
  CREATED:             { label: "Contract Created",       category: "green", Icon: FileText },
  UPLOADED:            { label: "File Uploaded",          category: "green", Icon: Upload },
  UPDATED:             { label: "Contract Updated",       category: "amber", Icon: RefreshCw },
  STATUS_CHANGED:      { label: "Status Changed",         category: "amber", Icon: RefreshCw },
  COMMENTED:           { label: "Comment Added",          category: "blue",  Icon: FileText },
  APPROVAL_REQUESTED:  { label: "Approval Requested",     category: "blue",  Icon: UserPlus },
  APPROVED:            { label: "Approved",               category: "green", Icon: CheckCircle },
  REJECTED:            { label: "Rejected",               category: "red",   Icon: XCircle },
  SENT_FOR_SIGNATURE:  { label: "Sent for Signature",     category: "blue",  Icon: PenLine },
  SIGNED:              { label: "Signed",                 category: "green", Icon: PenLine },
  ALERT_FIRED:         { label: "Alert Triggered",        category: "amber", Icon: Bell },
  METADATA_EXTRACTED:  { label: "AI Extraction",          category: "green", Icon: Key },
  METADATA_UPDATED:    { label: "Metadata Updated",       category: "amber", Icon: RefreshCw },
  DOWNLOADED:          { label: "Downloaded",             category: "blue",  Icon: Download },
  DELETED:             { label: "Deleted",                category: "red",   Icon: Trash2 },
  ARCHIVED:            { label: "Archived",               category: "red",   Icon: Trash2 },
  TAGGED:              { label: "Tag Applied",            category: "green", Icon: Tag },
}

const FALLBACK_META: ActionMeta = { label: "Activity", category: "blue", Icon: Eye }

const CATEGORY_STYLE: Record<Category, string> = {
  green: "bg-emerald-100 text-emerald-600",
  amber: "bg-amber-100 text-amber-600",
  red:   "bg-red-100 text-red-600",
  blue:  "bg-sky-100 text-sky-600",
}

// ─── API types ────────────────────────────────────────────────────────────────

interface ActivityItem {
  id: string
  action: string
  actorLabel: string
  detail: string | null
  createdAt: string
  user: { id: string; name: string } | null
  contract: { id: string; title: string } | null
}

// ─── Filter options ───────────────────────────────────────────────────────────

const ACTION_OPTIONS = [
  { value: "",                   label: "All Actions" },
  { value: "CREATED",            label: "Contract Created" },
  { value: "UPLOADED",           label: "File Uploaded" },
  { value: "UPDATED",            label: "Contract Updated" },
  { value: "STATUS_CHANGED",     label: "Status Changed" },
  { value: "APPROVED",           label: "Approved" },
  { value: "REJECTED",           label: "Rejected" },
  { value: "SENT_FOR_SIGNATURE", label: "Sent for Signature" },
  { value: "SIGNED",             label: "Signed" },
  { value: "ARCHIVED",           label: "Archived" },
  { value: "ALERT_FIRED",        label: "Alert Triggered" },
  { value: "METADATA_EXTRACTED", label: "AI Extraction" },
]

const DATE_OPTIONS = [
  { value: "7",   label: "Last 7 days" },
  { value: "30",  label: "Last 30 days" },
  { value: "90",  label: "Last 90 days" },
  { value: "0",   label: "All time" },
]

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days > 1 ? "s" : ""} ago`
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function getInitials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AuditLogPage() {
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [total, setTotal]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage]     = useState(1)
  const pageSize = 20

  const [search,       setSearch]       = useState("")
  const [actionFilter, setActionFilter] = useState("")
  const [daysFilter,   setDaysFilter]   = useState("30")

  // Debounce search
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const fetchActivities = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page:  String(page),
        limit: String(pageSize),
      })
      if (debouncedSearch) params.set("search", debouncedSearch)
      if (actionFilter)    params.set("action", actionFilter)
      if (daysFilter !== "0") params.set("days", daysFilter)

      const res = await fetch(`/api/activities?${params}`, { signal, credentials: "include" })
      if (!res.ok) throw new Error("Failed")
      const data = await res.json()
      setActivities(data.activities ?? [])
      setTotal(data.total ?? 0)
    } catch (e) {
      if ((e as Error).name === "AbortError") return
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, actionFilter, daysFilter, page])

  useEffect(() => {
    const controller = new AbortController()
    fetchActivities(controller.signal)
    return () => controller.abort()
  }, [fetchActivities])

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1) }, [debouncedSearch, actionFilter, daysFilter])

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between px-7 py-5 border-b border-border shrink-0">
        <div>
          <h1 className="text-[18px] font-bold text-foreground">Audit Log</h1>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">
            All activity across your organization — {total} event{total !== 1 ? "s" : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" disabled>
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-5 space-y-4">
        {/* Filters */}
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search actions, users, contracts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 text-[13px] h-8"
          />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="h-8 rounded-[var(--radius)] border border-border bg-background px-3 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
          >
            {ACTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={daysFilter}
            onChange={(e) => setDaysFilter(e.target.value)}
            className="h-8 rounded-[var(--radius)] border border-border bg-background px-3 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
          >
            {DATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className={cn("overflow-hidden rounded-[var(--radius)] border border-border bg-card", loading && "opacity-60")}>
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-muted border-b border-border">
                {["Action", "Actor", "Resource", "Time"].map((h) => (
                  <th key={h} className="py-2.5 px-4 text-left text-[10.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <td key={j} className="py-3 px-4">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : activities.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-[13px] text-muted-foreground">
                    No activity found{actionFilter || search ? " for the selected filters" : ""}.
                  </td>
                </tr>
              ) : (
                activities.map((entry) => {
                  const meta = ACTION_META[entry.action] ?? FALLBACK_META
                  const { Icon } = meta
                  const displayName = entry.user?.name ?? entry.actorLabel
                  return (
                    <tr key={entry.id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                      {/* Action */}
                      <td className="py-3 px-4 text-[13px]">
                        <div className="flex items-center gap-2.5">
                          <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-full shrink-0", CATEGORY_STYLE[meta.category])}>
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <div>
                            <p className="font-medium text-foreground leading-tight">{meta.label}</p>
                            {entry.detail && (
                              <p className="text-[11px] text-muted-foreground leading-tight truncate max-w-[240px]">{entry.detail}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* Actor */}
                      <td className="py-3 px-4 text-[13px]">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-semibold shrink-0">
                            {getInitials(displayName)}
                          </span>
                          <span className="text-foreground">{displayName}</span>
                        </div>
                      </td>
                      {/* Resource — link to contract when available */}
                      <td className="py-3 px-4 text-[13px] text-foreground/80 max-w-[200px]">
                        {entry.contract ? (
                          <Link
                            href={`/contracts/${entry.contract.id}`}
                            className="truncate hover:text-primary transition-colors block"
                          >
                            {entry.contract.title}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      {/* Time */}
                      <td className="py-3 px-4 text-[13px] text-muted-foreground whitespace-nowrap">
                        {formatRelativeTime(entry.createdAt)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-[12.5px] text-muted-foreground">
            <span>
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="size-8" onClick={() => setPage((p) => p - 1)} disabled={page === 1 || loading}>
                <ChevronLeft className="size-4" />
              </Button>
              <span className="px-2">{page} / {totalPages}</span>
              <Button variant="outline" size="icon" className="size-8" onClick={() => setPage((p) => p + 1)} disabled={page === totalPages || loading}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {loading && activities.length === 0 && (
          <div className="flex justify-center py-4">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  )
}

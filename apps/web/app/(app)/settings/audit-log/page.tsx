"use client"

import { useState, useMemo } from "react"
import { Download, FileText, Upload, CheckCircle, RefreshCw, Key, UserPlus, XCircle, Trash2, PenLine, Eye } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// ─── Types ────────────────────────────────────────────────────────────────────

type ActionCategory = "green" | "amber" | "red" | "blue"

interface AuditEntry {
  id: number
  action: string
  category: ActionCategory
  userName: string
  userInitials: string
  resource: string
  time: string
  ip: string
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_ENTRIES: AuditEntry[] = [
  {
    id: 1,
    action: "Contract Created",
    category: "green",
    userName: "Alex Johnson",
    userInitials: "AJ",
    resource: "SaaS License Agreement",
    time: "2 min ago",
    ip: "192.168.1.45",
  },
  {
    id: 2,
    action: "File Uploaded",
    category: "green",
    userName: "Alex Johnson",
    userInitials: "AJ",
    resource: "SaaS_v3.pdf",
    time: "5 min ago",
    ip: "192.168.1.45",
  },
  {
    id: 3,
    action: "Approval Approved",
    category: "green",
    userName: "Sarah Kim",
    userInitials: "SK",
    resource: "SaaS License Agreement",
    time: "1 hour ago",
    ip: "10.0.0.12",
  },
  {
    id: 4,
    action: "Contract Updated",
    category: "amber",
    userName: "Michael Torres",
    userInitials: "MT",
    resource: "Service Agreement",
    time: "2 hours ago",
    ip: "10.0.0.8",
  },
  {
    id: 5,
    action: "API Key Created",
    category: "green",
    userName: "Alex Johnson",
    userInitials: "AJ",
    resource: "Production Key",
    time: "3 hours ago",
    ip: "192.168.1.45",
  },
  {
    id: 6,
    action: "Member Invited",
    category: "green",
    userName: "Alex Johnson",
    userInitials: "AJ",
    resource: "lisa.chen@company.com",
    time: "1 day ago",
    ip: "192.168.1.45",
  },
  {
    id: 7,
    action: "Approval Rejected",
    category: "red",
    userName: "Lisa Chen",
    userInitials: "LC",
    resource: "NDA — TechVentures",
    time: "1 day ago",
    ip: "172.16.0.5",
  },
  {
    id: 8,
    action: "Contract Deleted",
    category: "red",
    userName: "Michael Torres",
    userInitials: "MT",
    resource: "Old Partnership Agreement",
    time: "2 days ago",
    ip: "10.0.0.8",
  },
  {
    id: 9,
    action: "Contract Signed",
    category: "blue",
    userName: "Jane Smith",
    userInitials: "JS",
    resource: "SaaS License Agreement",
    time: "2 days ago",
    ip: "203.0.113.25",
  },
  {
    id: 10,
    action: "Member Removed",
    category: "red",
    userName: "Alex Johnson",
    userInitials: "AJ",
    resource: "john.doe@company.com",
    time: "3 days ago",
    ip: "192.168.1.45",
  },
]

const ACTION_OPTIONS = [
  { value: "", label: "All Actions" },
  { value: "Contract Created", label: "Contract Created" },
  { value: "Contract Updated", label: "Contract Updated" },
  { value: "Contract Deleted", label: "Contract Deleted" },
  { value: "Member Invited", label: "Member Invited" },
  { value: "Member Removed", label: "Member Removed" },
  { value: "API Key Created", label: "API Key Created" },
  { value: "Approval Approved", label: "Approval Approved" },
  { value: "Approval Rejected", label: "Approval Rejected" },
  { value: "File Uploaded", label: "File Uploaded" },
]

const DATE_OPTIONS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
]

// ─── Icon helpers ─────────────────────────────────────────────────────────────

function ActionIcon({ action, category }: { action: string; category: ActionCategory }) {
  const circleClass: Record<ActionCategory, string> = {
    green: "bg-emerald-100 text-emerald-600",
    amber: "bg-amber-100 text-amber-600",
    red: "bg-red-100 text-red-600",
    blue: "bg-sky-100 text-sky-600",
  }

  function Icon() {
    if (action.includes("Created") || action.includes("Invited")) return <UserPlus className="h-3.5 w-3.5" />
    if (action.includes("Uploaded")) return <Upload className="h-3.5 w-3.5" />
    if (action.includes("Approved")) return <CheckCircle className="h-3.5 w-3.5" />
    if (action.includes("Updated")) return <RefreshCw className="h-3.5 w-3.5" />
    if (action === "API Key Created") return <Key className="h-3.5 w-3.5" />
    if (action.includes("Rejected")) return <XCircle className="h-3.5 w-3.5" />
    if (action.includes("Deleted") || action.includes("Removed")) return <Trash2 className="h-3.5 w-3.5" />
    if (action.includes("Signed")) return <PenLine className="h-3.5 w-3.5" />
    if (action.includes("Exported")) return <Download className="h-3.5 w-3.5" />
    if (action.includes("Viewed")) return <Eye className="h-3.5 w-3.5" />
    return <FileText className="h-3.5 w-3.5" />
  }

  return (
    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full shrink-0 ${circleClass[category]}`}>
      <Icon />
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AuditLogPage() {
  const [search, setSearch] = useState("")
  const [actionFilter, setActionFilter] = useState("")
  const [dateFilter, setDateFilter] = useState("30d")

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return MOCK_ENTRIES.filter((entry) => {
      const matchesSearch =
        !q ||
        entry.action.toLowerCase().includes(q) ||
        entry.userName.toLowerCase().includes(q) ||
        entry.resource.toLowerCase().includes(q)
      const matchesAction = !actionFilter || entry.action === actionFilter
      return matchesSearch && matchesAction
    })
  }, [search, actionFilter])

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between px-7 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Audit Log</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track all actions taken in your organization
          </p>
        </div>
        <Button variant="outline" size="sm" className="flex items-center gap-2">
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-5 space-y-4">
        {/* Filters */}
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search actions, users, resources..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 text-[13px]"
          />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="h-9 rounded-[var(--radius)] border border-border bg-background px-3 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
          >
            {ACTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="h-9 rounded-[var(--radius)] border border-border bg-background px-3 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
          >
            {DATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-muted border-b border-border">
                <th className="py-2.5 px-4 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Action
                </th>
                <th className="py-2.5 px-4 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  User
                </th>
                <th className="py-2.5 px-4 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Resource
                </th>
                <th className="py-2.5 px-4 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Time
                </th>
                <th className="py-2.5 px-4 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  IP Address
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-[13px] text-muted-foreground">
                    No entries match your filters.
                  </td>
                </tr>
              ) : (
                filtered.map((entry) => (
                  <tr key={entry.id} className="border-b border-border hover:bg-muted/50 transition-colors">
                    <td className="py-3 px-4 text-[13px]">
                      <div className="flex items-center gap-2.5">
                        <ActionIcon action={entry.action} category={entry.category} />
                        <span className="font-medium text-foreground">{entry.action}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-[13px]">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-semibold shrink-0">
                          {entry.userInitials}
                        </span>
                        <span className="text-foreground">{entry.userName}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-[13px] text-foreground/80">{entry.resource}</td>
                    <td className="py-3 px-4 text-[13px] text-muted-foreground whitespace-nowrap">{entry.time}</td>
                    <td className="py-3 px-4 text-[13px] font-mono text-muted-foreground">{entry.ip}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between text-[13px] text-muted-foreground">
          <span>Showing 1–{filtered.length} of 247 entries</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled>
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

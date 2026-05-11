"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { format } from "date-fns"
import { toast } from "sonner"
import {
  ArrowLeft,
  CalendarDays,
  User,
  Tag,
  Bell,
  CheckCircle2,
  Clock,
  AlertCircle,
  Pencil,
  Trash2,
  RotateCcw,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { SubTaskList } from "@/components/obligations/subtask-list"
import { ObligationSheet } from "@/components/obligations/obligation-sheet"
import type { Obligation, ObligationStatus } from "@/components/obligations/types"
import type { OrgMember } from "@/lib/types"

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ObligationStatus, { label: string; icon: React.ElementType; className: string }> = {
  PENDING:     { label: "Pending",     icon: Clock,         className: "bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200" },
  IN_PROGRESS: { label: "In Progress", icon: Loader2,       className: "bg-blue-50 text-blue-700 ring-1 ring-blue-200" },
  COMPLETED:   { label: "Completed",   icon: CheckCircle2,  className: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
  OVERDUE:     { label: "Overdue",     icon: AlertCircle,   className: "bg-rose-50 text-rose-700 ring-1 ring-rose-200" },
}

const PRIORITY_CONFIG = {
  LOW:    { label: "Low",    className: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
  MEDIUM: { label: "Medium", className: "bg-amber-50 text-amber-700 ring-1 ring-amber-200" },
  HIGH:   { label: "High",   className: "bg-rose-50 text-rose-700 ring-1 ring-rose-200" },
}

const NEXT_STATUS: Partial<Record<ObligationStatus, ObligationStatus>> = {
  PENDING:     "IN_PROGRESS",
  IN_PROGRESS: "COMPLETED",
  OVERDUE:     "IN_PROGRESS",
}

function StatusBadge({ status }: { status: ObligationStatus }) {
  const cfg = STATUS_CONFIG[status]
  const Icon = cfg.icon
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", cfg.className)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  )
}

function MetaRow({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <Icon className="h-4 w-4 text-muted-foreground/60 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
        <div className="text-sm text-foreground">{children}</div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ObligationDetailPage() {
  const { id: contractId, obligationId } = useParams<{ id: string; obligationId: string }>()

  const [obligation, setObligation] = useState<Obligation | null>(null)
  const [contractTitle, setContractTitle] = useState<string>("")
  const [members, setMembers] = useState<OrgMember[]>([])
  const [role, setRole] = useState<string>("")
  const [loading, setLoading] = useState(true)

  const [editOpen, setEditOpen] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const [obligationRes, contractRes, membersRes] = await Promise.all([
        fetch(`/api/contracts/${contractId}/obligations/${obligationId}`),
        fetch(`/api/contracts/${contractId}`),
        fetch("/api/org/members"),
      ])

      if (obligationRes.ok) {
        setObligation(await obligationRes.json())
      }
      if (contractRes.ok) {
        const { contract, currentMember } = await contractRes.json()
        setContractTitle(contract?.title ?? "Contract")
        setRole(currentMember?.role ?? "")
      }
      if (membersRes.ok) {
        const data = await membersRes.json()
        setMembers(data.members ?? data ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [contractId, obligationId])

  useEffect(() => { fetchData() }, [fetchData])

  const canWrite = ["owner", "admin", "legal", "member"].includes(role)
  const canDelete = ["owner", "admin", "legal"].includes(role)

  async function updateStatus(status: ObligationStatus) {
    if (!obligation) return
    setUpdatingStatus(true)
    try {
      const res = await fetch(`/api/contracts/${contractId}/obligations/${obligationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error()
      setObligation(await res.json())
      toast.success(`Marked as ${status.replace("_", " ").toLowerCase()}`)
    } catch {
      toast.error("Failed to update status")
    } finally {
      setUpdatingStatus(false)
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this obligation? This cannot be undone.")) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/contracts/${contractId}/obligations/${obligationId}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error()
      toast.success("Obligation deleted")
      window.location.href = `/contracts/${contractId}?tab=obligations`
    } catch {
      toast.error("Failed to delete obligation")
      setDeleting(false)
    }
  }

  // ── Loading skeleton ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="mx-auto max-w-4xl px-6 py-4 flex items-center gap-4">
            <Skeleton className="h-8 w-8 rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-4xl px-6 py-8 grid grid-cols-3 gap-6">
          <div className="col-span-2 space-y-4">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!obligation) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-sm font-medium text-foreground">Obligation not found</p>
          <Link href={`/contracts/${contractId}?tab=obligations`}>
            <Button variant="outline" size="sm">Back to contract</Button>
          </Link>
        </div>
      </div>
    )
  }

  const statusCfg = STATUS_CONFIG[obligation.status]
  const priorityCfg = PRIORITY_CONFIG[obligation.priority]
  const nextStatus = NEXT_STATUS[obligation.status]
  const isCompleted = obligation.status === "COMPLETED"
  const isOverdue = obligation.status === "OVERDUE"
  const subDone = obligation.subTasks.filter((s) => s.isCompleted).length
  const subTotal = obligation.subTasks.length

  return (
    <div className="min-h-screen bg-background">

      {/* ── Sticky header ───────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto max-w-4xl px-6 py-4 flex items-center gap-4">
          <Link href={`/contracts/${contractId}?tab=obligations`}>
            <Button variant="ghost" size="icon-sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-semibold text-foreground leading-tight truncate">
                {obligation.title}
              </h1>
              <StatusBadge status={obligation.status} />
              <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", priorityCfg.className)}>
                {priorityCfg.label}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {contractTitle}
            </p>
          </div>

          {/* Actions */}
          {canWrite && (
            <div className="flex items-center gap-2 shrink-0">
              {nextStatus && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={updatingStatus}
                  onClick={() => updateStatus(nextStatus)}
                >
                  {updatingStatus
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {nextStatus === "IN_PROGRESS" ? "Start" : "Complete"}
                </Button>
              )}
              {isCompleted && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={updatingStatus}
                  onClick={() => updateStatus("PENDING")}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reopen
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
              {canDelete && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={deleting}
                  onClick={handleDelete}
                >
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-4xl px-6 py-8 grid grid-cols-3 gap-6">

        {/* Left — description + subtasks */}
        <div className="col-span-2 space-y-5">

          {/* Description */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Description
            </h2>
            {obligation.description ? (
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {obligation.description}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">No description added</p>
            )}
          </div>

          {/* Subtasks */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Tasks
              </h2>
              {subTotal > 0 && (
                <span className="text-xs text-muted-foreground">
                  {subDone} / {subTotal} done
                </span>
              )}
            </div>

            {subTotal > 0 && (
              <div className="mb-4">
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-500"
                    style={{ width: `${Math.round((subDone / subTotal) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            <SubTaskList
              contractId={contractId}
              obligation={obligation}
              canWrite={canWrite}
              onChange={(subTasks) => setObligation((prev) => prev ? { ...prev, subTasks } : prev)}
            />

            {subTotal === 0 && !canWrite && (
              <p className="text-sm text-muted-foreground italic">No tasks yet</p>
            )}
          </div>
        </div>

        {/* Right — metadata sidebar */}
        <div className="col-span-1">
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Details
            </h2>

            <MetaRow icon={CalendarDays} label="Due date">
              <span className={cn(isOverdue && "text-rose-600 font-medium")}>
                {format(new Date(obligation.dueDate), "MMM d, yyyy")}
              </span>
              {isOverdue && (
                <span className="ml-2 text-xs text-rose-500">Overdue</span>
              )}
            </MetaRow>

            <MetaRow icon={statusCfg.icon} label="Status">
              <StatusBadge status={obligation.status} />
            </MetaRow>

            <MetaRow icon={Tag} label="Priority">
              <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-medium", priorityCfg.className)}>
                {priorityCfg.label}
              </span>
            </MetaRow>

            <MetaRow icon={User} label="Assignee">
              {obligation.assignee ? (
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                    {obligation.assignee.name.charAt(0).toUpperCase()}
                  </div>
                  <span>{obligation.assignee.name}</span>
                </div>
              ) : (
                <span className="text-muted-foreground">Unassigned</span>
              )}
            </MetaRow>

            {obligation.clauseReference && (
              <MetaRow icon={Tag} label="Clause reference">
                {obligation.clauseReference}
              </MetaRow>
            )}

            <MetaRow icon={Bell} label="Reminder">
              {obligation.reminderDays} day{obligation.reminderDays === 1 ? "" : "s"} before due
              {obligation.reminderSentAt && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Sent {format(new Date(obligation.reminderSentAt), "MMM d, yyyy")}
                </p>
              )}
            </MetaRow>

            <MetaRow icon={User} label="Created by">
              <span>{obligation.createdBy.name}</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                {format(new Date(obligation.createdAt), "MMM d, yyyy")}
              </p>
            </MetaRow>

            {isCompleted && obligation.completedBy && (
              <MetaRow icon={CheckCircle2} label="Completed by">
                <span>{obligation.completedBy.name}</span>
                {obligation.completedAt && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {format(new Date(obligation.completedAt), "MMM d, yyyy")}
                  </p>
                )}
              </MetaRow>
            )}
          </div>
        </div>
      </div>

      {/* ── Edit sheet ────────────────────────────────────────────────── */}
      <ObligationSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        contractId={contractId}
        obligation={obligation}
        members={members}
        onSaved={(updated) => {
          setObligation(updated)
          setEditOpen(false)
        }}
      />
    </div>
  )
}

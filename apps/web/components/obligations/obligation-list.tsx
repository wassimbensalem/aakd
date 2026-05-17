"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { format, differenceInCalendarDays } from "date-fns"
import { Check, CheckSquare, Loader2, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ObligationSheet } from "./obligation-sheet"
import { SubTaskList } from "./subtask-list"
import type { Obligation, ObligationStatus } from "./types"
import type { OrgMember } from "@/lib/types"

interface AISuggestion {
  title: string
  description?: string
  clauseReference?: string
  priority: "HIGH" | "MEDIUM" | "LOW"
  suggestedDueDays: number
  confidence: number
}

interface Props {
  contractId: string
  obligations: Obligation[]
  members: OrgMember[]
  contractArchived: boolean
  role: string | undefined
  onChange: (next: Obligation[]) => void
}

const STATUS_BADGE: Record<ObligationStatus, string> = {
  PENDING: "bg-muted text-muted-foreground ring-1 ring-border",
  IN_PROGRESS: "bg-sky-50 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-800",
  COMPLETED: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800",
  OVERDUE: "bg-destructive/10 text-destructive ring-1 ring-destructive/20",
}

const PRIORITY_DOT: Record<Obligation["priority"], string> = {
  HIGH: "bg-rose-500",
  MEDIUM: "bg-amber-500",
  LOW: "bg-sky-500",
}

function isDueDateUrgent(dueDate: string, status: ObligationStatus): boolean {
  if (status === "OVERDUE") return true
  if (status === "COMPLETED") return false
  const days = differenceInCalendarDays(new Date(dueDate), new Date())
  return days <= 3
}

export function ObligationList({
  contractId,
  obligations,
  members,
  contractArchived,
  role,
  onChange,
}: Props) {
  const t = useTranslations("obligations")
  const STATUS_FILTERS: ReadonlyArray<{ key: "ALL" | ObligationStatus; label: string }> = [
    { key: "ALL",         label: t("filterAll") },
    { key: "PENDING",     label: t("status.PENDING") },
    { key: "IN_PROGRESS", label: t("status.IN_PROGRESS") },
    { key: "OVERDUE",     label: t("status.OVERDUE") },
    { key: "COMPLETED",   label: t("status.COMPLETED") },
  ]

  const [filter, setFilter] = useState<"ALL" | ObligationStatus>("ALL")
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<Obligation | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([])
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set())
  const [acceptingIdx, setAcceptingIdx] = useState<number | null>(null)
  const [acceptingAll, setAcceptingAll] = useState(false)
  const [jobId, setJobId] = useState<string | null>(() => {
    // Hydrate from localStorage on mount — survives navigation
    if (typeof window === "undefined") return null
    return localStorage.getItem(`obligation_extract_job_${contractId}`)
  })

  const canWrite = role === "owner" || role === "admin" || role === "legal" || role === "member"
  const canDelete = role === "owner" || role === "admin" || role === "legal"
  const canCreate = canWrite && !contractArchived

  const visible = useMemo(() => {
    if (filter === "ALL") return obligations
    return obligations.filter((o) => o.status === filter)
  }, [obligations, filter])

  function openCreate() {
    setEditing(null)
    setSheetOpen(true)
  }

  useEffect(() => {
    if (!jobId) return
    setExtracting(true)

    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/contracts/${contractId}/obligations/extract?jobId=${encodeURIComponent(jobId)}`
        )
        if (!res.ok || cancelled) return

        const data = await res.json()

        if (data.state === "completed") {
          if (!cancelled) {
            const s = data.suggestions ?? []
            if (s.length === 0) {
              toast.info("No obligations found in this contract.")
            } else {
              setSuggestions(s)
            }
            setExtracting(false)
            localStorage.removeItem(`obligation_extract_job_${contractId}`)
            setJobId(null)
          }
        } else if (data.state === "failed" || data.state === "not_found") {
          if (!cancelled) {
            toast.error("Obligation extraction failed. Please try again.")
            setExtracting(false)
            localStorage.removeItem(`obligation_extract_job_${contractId}`)
            setJobId(null)
          }
        }
        // "active" → keep polling
      } catch {
        if (!cancelled) {
          toast.error("Failed to check extraction status.")
          setExtracting(false)
          localStorage.removeItem(`obligation_extract_job_${contractId}`)
          setJobId(null)
        }
      }
    }

    // Poll immediately, then every 3 seconds
    poll()
    const interval = setInterval(poll, 3_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [jobId, contractId])

  async function extractWithAI() {
    setExtracting(true)
    setSuggestions([])
    setDismissedIds(new Set())
    try {
      const res = await fetch(`/api/contracts/${contractId}/obligations/extract`, { method: "POST" })
      if (res.status === 422) {
        const body = await res.json()
        if (body.error === "no_extracted_text") {
          toast.error("Contract text not yet extracted. Upload a PDF or DOCX first.")
        } else if (body.error === "no_ai_provider") {
          toast.error("No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.")
        } else {
          toast.error("Could not extract obligations.")
        }
        setExtracting(false)
        return
      }
      if (!res.ok) throw new Error()
      const { jobId: id } = await res.json()
      localStorage.setItem(`obligation_extract_job_${contractId}`, id)
      setJobId(id)
      // polling effect takes it from here
    } catch {
      toast.error("Failed to extract obligations.")
      setExtracting(false)
    }
  }

  async function acceptSuggestion(idx: number, s: AISuggestion) {
    setAcceptingIdx(idx)
    try {
      const dueDate = new Date()
      // Ensure at least 1 day in the future to pass server validation
      dueDate.setDate(dueDate.getDate() + Math.max(s.suggestedDueDays ?? 30, 1))
      const res = await fetch(`/api/contracts/${contractId}/obligations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: s.title,
          description: s.description,
          clauseReference: s.clauseReference,
          priority: s.priority,
          dueDate: dueDate.toISOString(),
          reminderDays: 7,
        }),
      })
      if (!res.ok) throw new Error()
      const created = await res.json()
      onChange([...obligations, created])
      setDismissedIds((prev) => new Set(prev).add(idx))
      toast.success(`Obligation "${s.title}" created.`)
    } catch {
      toast.error("Failed to create obligation.")
    } finally {
      setAcceptingIdx(null)
    }
  }

  async function acceptAll() {
    setAcceptingAll(true)
    const pending = suggestions
      .map((s, idx) => ({ s, idx }))
      .filter(({ idx }) => !dismissedIds.has(idx))

    const created: Obligation[] = []
    const newDismissed = new Set(dismissedIds)
    let failCount = 0

    for (const { s, idx } of pending) {
      try {
        const dueDate = new Date()
        // Ensure at least 1 day in the future to pass server validation
        const days = Math.max(s.suggestedDueDays ?? 30, 1)
        dueDate.setDate(dueDate.getDate() + days)
        const res = await fetch(`/api/contracts/${contractId}/obligations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: s.title,
            description: s.description,
            clauseReference: s.clauseReference,
            priority: s.priority,
            dueDate: dueDate.toISOString(),
            reminderDays: 7,
          }),
        })
        if (res.ok) {
          const ob = await res.json()
          created.push(ob)
          newDismissed.add(idx)
        } else {
          failCount++
        }
      } catch {
        failCount++
      }
    }

    if (created.length > 0) {
      onChange([...obligations, ...created])
      setDismissedIds(newDismissed)
      // Only clear the suggestions panel when at least some were saved.
      // If everything succeeded, also clear localStorage.
      if (failCount === 0) {
        setSuggestions([])
        localStorage.removeItem(`obligation_extract_job_${contractId}`)
        setJobId(null)
      }
      toast.success(`${created.length} obligation${created.length !== 1 ? "s" : ""} created.${failCount > 0 ? ` ${failCount} failed — remaining suggestions kept.` : ""}`)
    } else {
      // Nothing was created — keep suggestions visible so the user can retry.
      toast.error("Failed to create obligations. Please try again.")
    }
    setAcceptingAll(false)
  }

  function openEdit(ob: Obligation) {
    setEditing(ob)
    setSheetOpen(true)
  }

  function applyChange(updated: Obligation) {
    onChange(
      obligations.some((o) => o.id === updated.id)
        ? obligations.map((o) => (o.id === updated.id ? updated : o))
        : [...obligations, updated],
    )
  }

  async function complete(ob: Obligation) {
    try {
      const res = await fetch(`/api/contracts/${contractId}/obligations/${ob.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      })
      if (!res.ok) throw new Error()
      const next = await res.json()
      applyChange(next)
      toast.success("Obligation completed")
    } catch {
      toast.error("Failed to mark complete")
    }
  }

  async function remove(ob: Obligation) {
    if (!confirm(`Delete obligation "${ob.title}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/contracts/${contractId}/obligations/${ob.id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error()
      onChange(obligations.filter((o) => o.id !== ob.id))
      toast.success("Obligation deleted")
    } catch {
      toast.error("Failed to delete obligation")
    }
  }

  if (obligations.length === 0 && suggestions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <CheckSquare className="size-10 text-muted-foreground/40" />
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">No obligations yet</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Track deliverables, payments, and commitments here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
            <Button size="sm" variant="outline" onClick={extractWithAI} disabled={extracting}>
              {extracting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {extracting ? "Extracting…" : "Extract with AI"}
            </Button>
          )}
          {canCreate && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" />
              Add Obligation
            </Button>
          )}
        </div>

        {extracting && (
          <div className="w-full max-w-lg rounded-[var(--radius)] border border-border bg-muted/40 p-4 space-y-3 animate-pulse">
            <div className="h-4 w-48 rounded bg-muted" />
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-[var(--radius)] border border-border bg-card p-3 flex items-start gap-3">
                  <div className="mt-1.5 size-2 rounded-full bg-muted shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-3/4 rounded bg-muted" />
                    <div className="h-3 w-full rounded bg-muted/60" />
                  </div>
                  <div className="h-7 w-16 rounded bg-muted shrink-0" />
                </div>
              ))}
            </div>
          </div>
        )}

        <ObligationSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          contractId={contractId}
          members={members}
          obligation={editing}
          onSaved={applyChange}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filter === f.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
            <Button
              size="sm"
              variant="outline"
              onClick={extractWithAI}
              disabled={extracting}
            >
              {extracting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {extracting ? "Extracting…" : "Extract with AI"}
            </Button>
          )}
          {canCreate && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" />
              Add Obligation
            </Button>
          )}
        </div>
      </div>

      {/* Loading skeleton */}
      {extracting && (
        <div className="rounded-[var(--radius)] border border-border bg-muted/40 p-4 space-y-3 animate-pulse">
          <div className="h-4 w-48 rounded bg-muted" />
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-[var(--radius)] border border-border bg-card p-3 flex items-start gap-3">
                <div className="mt-1.5 size-2 rounded-full bg-muted shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-3/4 rounded bg-muted" />
                  <div className="h-3 w-full rounded bg-muted/60" />
                  <div className="h-3 w-1/2 rounded bg-muted/60" />
                </div>
                <div className="h-7 w-16 rounded bg-muted shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Suggestions Panel */}
      {suggestions.length > 0 && (
        <div className="rounded-[var(--radius)] border border-primary/20 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">
              AI found {suggestions.length} suggestion{suggestions.length !== 1 ? "s" : ""} — review and accept
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={acceptingAll}
                onClick={acceptAll}
              >
                {acceptingAll ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
                {acceptingAll ? "Accepting…" : `Accept All (${suggestions.filter((_, i) => !dismissedIds.has(i)).length})`}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setSuggestions([])
                  localStorage.removeItem(`obligation_extract_job_${contractId}`)
                  setJobId(null)
                }}
                className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Dismiss all suggestions"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {suggestions.map((s, idx) => {
              const dismissed = dismissedIds.has(idx)
              if (dismissed) return null
              const dueDate = new Date()
              dueDate.setDate(dueDate.getDate() + Math.max(s.suggestedDueDays ?? 30, 1))
              return (
                <div key={idx} className="rounded-[var(--radius)] border border-border bg-card p-3 flex items-start gap-3">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", PRIORITY_DOT[s.priority])} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{s.title}</p>
                    {s.description && <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                      {s.clauseReference && <span>{s.clauseReference}</span>}
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 font-medium text-[10px]",
                          s.confidence >= 0.8
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                            : s.confidence >= 0.5
                              ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                              : "bg-muted text-muted-foreground",
                        )}
                      >
                        {Math.round(s.confidence * 100)}% confidence
                      </span>
                      <span>Due ~{format(dueDate, "MMM d, yyyy")}</span>
                      <span className="capitalize">{s.priority.toLowerCase()} priority</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={acceptingIdx === idx || acceptingAll}
                      onClick={() => acceptSuggestion(idx, s)}
                    >
                      {acceptingIdx === idx ? <Loader2 className="size-3 animate-spin" /> : "Accept"}
                    </Button>
                    <button
                      type="button"
                      onClick={() => {
                        setDismissedIds((prev) => new Set(prev).add(idx))
                        toast("Suggestion dismissed", {
                          action: {
                            label: "Undo",
                            onClick: () =>
                              setDismissedIds((prev) => {
                                const next = new Set(prev)
                                next.delete(idx)
                                return next
                              }),
                          },
                          duration: 5000,
                        })
                      }}
                      className="rounded p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Dismiss suggestion"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* List */}
      {visible.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">
          No obligations match this filter.
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((ob) => {
            const subTotal = ob.subTasks.length
            const subDone = ob.subTasks.filter((s) => s.isCompleted).length
            const dueUrgent = isDueDateUrgent(ob.dueDate, ob.status)
            return (
              <div
                key={ob.id}
                className="rounded-[var(--radius)] border border-border bg-card p-4"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn("mt-1.5 size-2 shrink-0 rounded-full", PRIORITY_DOT[ob.priority])}
                    title={`${ob.priority} priority`}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/contracts/${contractId}/obligations/${ob.id}`}
                        className="text-sm font-semibold text-foreground hover:text-primary hover:underline underline-offset-2 transition-colors"
                      >
                        {ob.title}
                      </Link>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          STATUS_BADGE[ob.status],
                        )}
                      >
                        {ob.status.replace("_", " ")}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span
                        className={cn(
                          "font-medium",
                          dueUrgent ? "text-destructive" : "text-foreground/70",
                        )}
                      >
                        Due {format(new Date(ob.dueDate), "MMM d, yyyy")}
                      </span>
                      {ob.assignee && (
                        <span className="inline-flex items-center gap-1">
                          <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                            {ob.assignee.name.charAt(0).toUpperCase()}
                          </span>
                          {ob.assignee.name}
                        </span>
                      )}
                      {ob.clauseReference && (
                        <span className="text-muted-foreground/60">{ob.clauseReference}</span>
                      )}
                    </div>

                    {ob.description && (
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                        {ob.description}
                      </p>
                    )}

                    {subTotal > 0 && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            {subDone} / {subTotal} tasks
                          </span>
                        </div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary transition-[width]"
                            style={{
                              width: `${Math.round((subDone / subTotal) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}

                    <SubTaskList
                      contractId={contractId}
                      obligation={ob}
                      canWrite={canWrite && !contractArchived}
                      onChange={(subTasks) =>
                        applyChange({ ...ob, subTasks })
                      }
                    />
                  </div>

                  {canWrite && !contractArchived && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(ob)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        aria-label="Edit obligation"
                      >
                        <Pencil className="size-4" />
                      </button>
                      {ob.status !== "COMPLETED" && (
                        <button
                          type="button"
                          onClick={() => complete(ob)}
                          className="rounded p-1.5 text-muted-foreground hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950 dark:hover:text-emerald-300 transition-colors"
                          aria-label="Mark complete"
                        >
                          <Check className="size-4" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => remove(ob)}
                          className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                          aria-label="Delete obligation"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ObligationSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        contractId={contractId}
        members={members}
        obligation={editing}
        onSaved={applyChange}
      />
    </div>
  )
}

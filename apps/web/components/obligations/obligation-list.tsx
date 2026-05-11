"use client"

import { useMemo, useState } from "react"
import { format, differenceInCalendarDays } from "date-fns"
import { Check, CheckSquare, Loader2, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react"
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
}

interface Props {
  contractId: string
  obligations: Obligation[]
  members: OrgMember[]
  contractArchived: boolean
  role: string | undefined
  onChange: (next: Obligation[]) => void
}

const STATUS_FILTERS: ReadonlyArray<{ key: "ALL" | ObligationStatus; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "PENDING", label: "Pending" },
  { key: "IN_PROGRESS", label: "In Progress" },
  { key: "OVERDUE", label: "Overdue" },
  { key: "COMPLETED", label: "Completed" },
]

const STATUS_BADGE: Record<ObligationStatus, string> = {
  PENDING: "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200",
  IN_PROGRESS: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  OVERDUE: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
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
  const [filter, setFilter] = useState<"ALL" | ObligationStatus>("ALL")
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<Obligation | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([])
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set())
  const [acceptingIdx, setAcceptingIdx] = useState<number | null>(null)

  const canWrite = role === "admin" || role === "legal" || role === "member"
  const canDelete = role === "admin" || role === "legal"
  const canCreate = canWrite && !contractArchived

  const visible = useMemo(() => {
    if (filter === "ALL") return obligations
    return obligations.filter((o) => o.status === filter)
  }, [obligations, filter])

  function openCreate() {
    setEditing(null)
    setSheetOpen(true)
  }

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
        return
      }
      if (!res.ok) throw new Error()
      const { suggestions: s } = await res.json()
      if (!s || s.length === 0) {
        toast.info("No obligations found in this contract.")
        return
      }
      setSuggestions(s)
    } catch {
      toast.error("Failed to extract obligations.")
    } finally {
      setExtracting(false)
    }
  }

  async function acceptSuggestion(idx: number, s: AISuggestion) {
    setAcceptingIdx(idx)
    try {
      const dueDate = new Date()
      dueDate.setDate(dueDate.getDate() + s.suggestedDueDays)
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
        <CheckSquare className="size-10 text-zinc-300" />
        <div className="text-center">
          <p className="text-sm font-medium text-zinc-700">No obligations yet</p>
          <p className="mt-0.5 text-xs text-zinc-500">
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
                  ? "bg-indigo-600 text-white"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200",
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

      {/* AI Suggestions Panel */}
      {suggestions.length > 0 && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-indigo-900">
              AI found {suggestions.length} suggestion{suggestions.length !== 1 ? "s" : ""} — review and accept
            </p>
            <button
              type="button"
              onClick={() => setSuggestions([])}
              className="rounded p-1 text-indigo-400 hover:text-indigo-700"
              aria-label="Dismiss all suggestions"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="space-y-2">
            {suggestions.map((s, idx) => {
              const dismissed = dismissedIds.has(idx)
              if (dismissed) return null
              const dueDate = new Date()
              dueDate.setDate(dueDate.getDate() + s.suggestedDueDays)
              return (
                <div key={idx} className="rounded-md border border-indigo-100 bg-white p-3 flex items-start gap-3">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", PRIORITY_DOT[s.priority])} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-900">{s.title}</p>
                    {s.description && <p className="text-xs text-zinc-500 mt-0.5">{s.description}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-zinc-400">
                      {s.clauseReference && <span>{s.clauseReference}</span>}
                      <span>Due ~{format(dueDate, "MMM d, yyyy")}</span>
                      <span className="capitalize">{s.priority.toLowerCase()} priority</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={acceptingIdx === idx}
                      onClick={() => acceptSuggestion(idx, s)}
                    >
                      {acceptingIdx === idx ? <Loader2 className="size-3 animate-spin" /> : "Accept"}
                    </Button>
                    <button
                      type="button"
                      onClick={() => setDismissedIds((prev) => new Set(prev).add(idx))}
                      className="rounded p-1.5 text-zinc-400 hover:text-zinc-700"
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
        <p className="text-center text-sm text-zinc-500 py-8">
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
                className="rounded-lg border border-zinc-200 bg-white p-4"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn("mt-1.5 size-2 shrink-0 rounded-full", PRIORITY_DOT[ob.priority])}
                    title={`${ob.priority} priority`}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-zinc-900">{ob.title}</p>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          STATUS_BADGE[ob.status],
                        )}
                      >
                        {ob.status.replace("_", " ")}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                      <span
                        className={cn(
                          "font-medium",
                          dueUrgent ? "text-rose-600" : "text-zinc-600",
                        )}
                      >
                        Due {format(new Date(ob.dueDate), "MMM d, yyyy")}
                      </span>
                      {ob.assignee && (
                        <span className="inline-flex items-center gap-1">
                          <span className="flex size-4 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-medium text-zinc-600">
                            {ob.assignee.name.charAt(0).toUpperCase()}
                          </span>
                          {ob.assignee.name}
                        </span>
                      )}
                      {ob.clauseReference && (
                        <span className="text-zinc-400">{ob.clauseReference}</span>
                      )}
                    </div>

                    {ob.description && (
                      <p className="mt-2 line-clamp-2 text-sm text-zinc-600">
                        {ob.description}
                      </p>
                    )}

                    {subTotal > 0 && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-zinc-500">
                          <span>
                            {subDone} / {subTotal} tasks
                          </span>
                        </div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-100">
                          <div
                            className="h-full bg-indigo-500 transition-[width]"
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
                        className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                        aria-label="Edit obligation"
                      >
                        <Pencil className="size-4" />
                      </button>
                      {ob.status !== "COMPLETED" && (
                        <button
                          type="button"
                          onClick={() => complete(ob)}
                          className="rounded p-1.5 text-zinc-500 hover:bg-emerald-50 hover:text-emerald-700"
                          aria-label="Mark complete"
                        >
                          <Check className="size-4" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => remove(ob)}
                          className="rounded p-1.5 text-zinc-500 hover:bg-rose-50 hover:text-rose-700"
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

"use client"

import { useState } from "react"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Obligation, ObligationSubTask } from "./types"

interface Props {
  contractId: string
  obligation: Obligation
  canWrite: boolean
  onChange: (next: ObligationSubTask[]) => void
}

export function SubTaskList({ contractId, obligation, canWrite, onChange }: Props) {
  const [newTitle, setNewTitle] = useState("")
  const [busy, setBusy] = useState(false)

  async function toggle(sub: ObligationSubTask) {
    const optimistic = obligation.subTasks.map((s) =>
      s.id === sub.id ? { ...s, isCompleted: !s.isCompleted } : s,
    )
    onChange(optimistic)
    try {
      const res = await fetch(
        `/api/contracts/${contractId}/obligations/${obligation.id}/subtasks/${sub.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isCompleted: !sub.isCompleted }),
        },
      )
      if (!res.ok) throw new Error()
      const updated = await res.json()
      onChange(obligation.subTasks.map((s) => (s.id === sub.id ? updated : s)))
    } catch {
      toast.error("Failed to update task")
      onChange(obligation.subTasks)
    }
  }

  async function remove(sub: ObligationSubTask) {
    const previous = obligation.subTasks
    onChange(previous.filter((s) => s.id !== sub.id))
    try {
      const res = await fetch(
        `/api/contracts/${contractId}/obligations/${obligation.id}/subtasks/${sub.id}`,
        { method: "DELETE" },
      )
      if (!res.ok) throw new Error()
    } catch {
      toast.error("Failed to delete task")
      onChange(previous)
    }
  }

  async function add() {
    const title = newTitle.trim()
    if (!title || busy) return
    setBusy(true)
    try {
      const res = await fetch(
        `/api/contracts/${contractId}/obligations/${obligation.id}/subtasks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        if (body?.error === "subtask_limit_reached") {
          toast.error("Maximum 20 sub-tasks per obligation")
        } else {
          toast.error("Failed to add task")
        }
        return
      }
      const created = await res.json()
      onChange([...obligation.subTasks, created])
      setNewTitle("")
    } finally {
      setBusy(false)
    }
  }

  if (obligation.subTasks.length === 0 && !canWrite) return null

  return (
    <div className="mt-3 space-y-1.5">
      {obligation.subTasks.map((sub) => (
        <div key={sub.id} className="group flex items-center gap-2">
          <Checkbox
            checked={sub.isCompleted}
            disabled={!canWrite}
            onCheckedChange={() => {
              if (canWrite) toggle(sub)
            }}
          />
          <span
            className={cn(
              "flex-1 text-sm text-zinc-700",
              sub.isCompleted && "text-zinc-400 line-through",
            )}
          >
            {sub.title}
          </span>
          {canWrite && (
            <button
              type="button"
              onClick={() => remove(sub)}
              className="rounded p-1 text-zinc-300 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100"
              aria-label="Delete task"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      ))}

      {canWrite && (
        <div className="flex items-center gap-2">
          <Input
            placeholder="Add task and press Enter"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
            }}
            className="h-7 flex-1 text-xs"
            disabled={busy}
          />
          {newTitle.trim() && (
            <Button size="sm" className="h-7 text-xs" onClick={add} disabled={busy}>
              Add
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

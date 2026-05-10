"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { Obligation, ObligationPriority } from "./types"
import type { OrgMember } from "@/lib/types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  contractId: string
  obligation: Obligation | null
  members: OrgMember[]
  onSaved: (obligation: Obligation) => void
}

const REMINDER_OPTIONS = [1, 3, 7, 14, 30] as const
const UNASSIGNED = "__none__"

interface FormState {
  title: string
  description: string
  dueDate: string
  priority: ObligationPriority
  assigneeId: string
  clauseReference: string
  reminderDays: number
}

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  dueDate: "",
  priority: "MEDIUM",
  assigneeId: UNASSIGNED,
  clauseReference: "",
  reminderDays: 7,
}

function obligationToForm(o: Obligation): FormState {
  return {
    title: o.title,
    description: o.description ?? "",
    dueDate: o.dueDate.slice(0, 10),
    priority: o.priority,
    assigneeId: o.assignee?.id ?? UNASSIGNED,
    clauseReference: o.clauseReference ?? "",
    reminderDays: o.reminderDays,
  }
}

export function ObligationSheet({
  open,
  onOpenChange,
  contractId,
  obligation,
  members,
  onSaved,
}: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(obligation ? obligationToForm(obligation) : EMPTY_FORM)
  }, [open, obligation])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((p) => ({ ...p, [key]: value }))
  }

  async function save() {
    if (!form.title.trim()) {
      toast.error("Title is required")
      return
    }
    if (!form.dueDate) {
      toast.error("Due date is required")
      return
    }

    setSaving(true)
    try {
      // Send midnight UTC of the chosen date so server-side `z.string().datetime()`
      // accepts it. Free-text fields collapse to undefined when empty so PATCH
      // doesn't overwrite an existing value with a blank string.
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        clauseReference: form.clauseReference.trim() || undefined,
        priority: form.priority,
        dueDate: new Date(`${form.dueDate}T00:00:00.000Z`).toISOString(),
        reminderDays: form.reminderDays,
        assigneeId: form.assigneeId === UNASSIGNED ? undefined : form.assigneeId,
      }

      const url = obligation
        ? `/api/contracts/${contractId}/obligations/${obligation.id}`
        : `/api/contracts/${contractId}/obligations`
      const method = obligation ? "PATCH" : "POST"

      // PATCH uses `null` to clear an assignee; POST uses `undefined` to skip it.
      if (obligation && form.assigneeId === UNASSIGNED) body.assigneeId = null

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        if (err?.error === "obligation_limit_reached") {
          toast.error("Maximum 100 active obligations per contract")
        } else if (err?.error === "contract_archived") {
          toast.error("Cannot add obligations to an archived contract")
        } else if (err?.error === "invalid_assignee") {
          toast.error("Selected assignee is not a member of this organization")
        } else {
          toast.error(obligation ? "Failed to update obligation" : "Failed to create obligation")
        }
        return
      }

      const saved = await res.json()
      onSaved(saved)
      toast.success(obligation ? "Obligation updated" : "Obligation created")
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{obligation ? "Edit Obligation" : "New Obligation"}</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-4 px-1 pb-2">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              value={form.title}
              maxLength={300}
              onChange={(e) => update("title", e.target.value)}
              placeholder="e.g. Pay Q2 invoice"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              rows={3}
              value={form.description}
              maxLength={2000}
              onChange={(e) => update("description", e.target.value)}
              placeholder="Optional context for whoever owns this obligation"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Due Date</Label>
              <Input
                type="date"
                value={form.dueDate}
                onChange={(e) => update("dueDate", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select
                value={form.priority}
                onValueChange={(v) => update("priority", v as ObligationPriority)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Assignee</Label>
            <Select
              value={form.assigneeId}
              onValueChange={(v) => update("assigneeId", v ?? UNASSIGNED)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.user.name} ({m.user.email})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Clause Reference</Label>
            <Input
              value={form.clauseReference}
              maxLength={200}
              onChange={(e) => update("clauseReference", e.target.value)}
              placeholder="e.g. Section 4.2"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Reminder</Label>
            <Select
              value={String(form.reminderDays)}
              onValueChange={(v) => update("reminderDays", Number(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REMINDER_OPTIONS.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} day{d === 1 ? "" : "s"} before due
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-3 pt-2">
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving..." : obligation ? "Save Changes" : "Create Obligation"}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

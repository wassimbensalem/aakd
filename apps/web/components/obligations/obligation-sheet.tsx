"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { X, CalendarDays, User, Tag, Bell, AlignLeft, Type } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
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

const PRIORITY_OPTIONS: { value: ObligationPriority; label: string; colors: string }[] = [
  { value: "LOW",    label: "Low",    colors: "border-emerald-200 bg-emerald-50 text-emerald-700 data-[active=true]:bg-emerald-100 data-[active=true]:border-emerald-400" },
  { value: "MEDIUM", label: "Medium", colors: "border-amber-200 bg-amber-50 text-amber-700 data-[active=true]:bg-amber-100 data-[active=true]:border-amber-400" },
  { value: "HIGH",   label: "High",   colors: "border-rose-200 bg-rose-50 text-rose-700 data-[active=true]:bg-rose-100 data-[active=true]:border-rose-400" },
]

function FieldLabel({ icon: Icon, label, required }: { icon: React.ElementType; label: string; required?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-rose-400">*</span>}
      </span>
    </div>
  )
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

  const isEditing = obligation !== null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col w-full gap-0 p-0 sm:max-w-md">

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {isEditing ? "Edit Obligation" : "New Obligation"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isEditing ? "Update the details below" : "Track a commitment or deliverable"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* ── Body ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Title */}
          <div>
            <FieldLabel icon={Type} label="Title" required />
            <Input
              value={form.title}
              maxLength={300}
              onChange={(e) => update("title", e.target.value)}
              placeholder="e.g. Submit quarterly compliance report"
              className="text-sm"
            />
          </div>

          {/* Description */}
          <div>
            <FieldLabel icon={AlignLeft} label="Description" />
            <Textarea
              rows={3}
              value={form.description}
              maxLength={2000}
              onChange={(e) => update("description", e.target.value)}
              placeholder="Optional context for whoever owns this obligation"
              className="text-sm resize-none"
            />
          </div>

          {/* Priority — pill toggle */}
          <div>
            <FieldLabel icon={Tag} label="Priority" />
            <div className="flex gap-2">
              {PRIORITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  data-active={form.priority === opt.value}
                  onClick={() => update("priority", opt.value)}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-all",
                    opt.colors,
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-border" />

          {/* Due date + Reminder */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel icon={CalendarDays} label="Due Date" required />
              <Input
                type="date"
                value={form.dueDate}
                onChange={(e) => update("dueDate", e.target.value)}
                className="text-sm"
              />
            </div>
            <div>
              <FieldLabel icon={Bell} label="Remind me" />
              <Select
                value={String(form.reminderDays)}
                onValueChange={(v) => update("reminderDays", Number(v))}
              >
                <SelectTrigger className="w-full text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REMINDER_OPTIONS.map((d) => (
                    <SelectItem key={d} value={String(d)} className="text-sm">
                      {d} day{d === 1 ? "" : "s"} before
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {obligation?.reminderSentAt && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Sent{" "}
                  {new Date(obligation.reminderSentAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              )}
            </div>
          </div>

          <div className="border-t border-border" />

          {/* Assignee */}
          <div>
            <FieldLabel icon={User} label="Assignee" />
            <Select
              value={form.assigneeId}
              onValueChange={(v) => update("assigneeId", v ?? UNASSIGNED)}
            >
              <SelectTrigger className="w-full text-sm">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED} className="text-sm">
                  <span className="text-muted-foreground">Unassigned</span>
                </SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.userId} value={m.userId} className="text-sm">
                    <div className="flex items-center gap-2">
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                        {(m.user.name ?? m.user.email).charAt(0).toUpperCase()}
                      </div>
                      <span>{m.user.name ?? m.user.email}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Clause reference */}
          <div>
            <FieldLabel icon={Tag} label="Clause Reference" />
            <Input
              value={form.clauseReference}
              maxLength={200}
              onChange={(e) => update("clauseReference", e.target.value)}
              placeholder="e.g. Section 4.2"
              className="text-sm"
            />
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : isEditing ? "Save Changes" : "Create Obligation"}
          </Button>
        </div>

      </SheetContent>
    </Sheet>
  )
}

"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  X,
  CalendarDays,
  User,
  Tag,
  Bell,
  AlignLeft,
  Type,
  Check,
  ChevronDown,
  Bookmark,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import type { Obligation, ObligationPriority } from "./types"
import type { OrgMember } from "@/lib/types"

// ─── Constants ────────────────────────────────────────────────────────────────

const REMINDER_OPTIONS = [
  { value: 1,  label: "1d" },
  { value: 3,  label: "3d" },
  { value: 7,  label: "7d" },
  { value: 14, label: "14d" },
  { value: 30, label: "30d" },
] as const

const UNASSIGNED = "__none__"

const PRIORITY_STYLE: Record<ObligationPriority, { dot: string; pill: string }> = {
  LOW: {
    dot:  "bg-emerald-500",
    pill: "border-emerald-200 bg-emerald-50 text-emerald-700 data-[active=true]:bg-emerald-100 data-[active=true]:border-emerald-400 data-[active=true]:shadow-sm",
  },
  MEDIUM: {
    dot:  "bg-amber-500",
    pill: "border-amber-200 bg-amber-50 text-amber-700 data-[active=true]:bg-amber-100 data-[active=true]:border-amber-400 data-[active=true]:shadow-sm",
  },
  HIGH: {
    dot:  "bg-rose-500",
    pill: "border-rose-200 bg-rose-50 text-rose-700 data-[active=true]:bg-rose-100 data-[active=true]:border-rose-400 data-[active=true]:shadow-sm",
  },
}

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({
  icon: Icon,
  label,
  required,
}: {
  icon: React.ElementType
  label: string
  required?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground/50" />
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
        {label}
        {required && <span className="ml-0.5 text-rose-400">*</span>}
      </span>
    </div>
  )
}

function memberInitials(m: OrgMember): string {
  const name = m.user.name ?? m.user.email
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

function MemberAvatar({ initials, size = "md" }: { initials: string; size?: "sm" | "md" }) {
  return (
    <div
      className={cn(
        "shrink-0 flex items-center justify-center rounded-full bg-primary/10 font-semibold text-primary",
        size === "sm" ? "h-5 w-5 text-[9px]" : "h-7 w-7 text-[11px]",
      )}
    >
      {initials}
    </div>
  )
}

// ─── Assignee Picker ──────────────────────────────────────────────────────────

function AssigneePicker({
  value,
  members,
  onChange,
}: {
  value: string
  members: OrgMember[]
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = members.find((m) => m.userId === value) ?? null

  useEffect(() => {
    if (!open) return
    function onPointer(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("pointerdown", onPointer)
    return () => document.removeEventListener("pointerdown", onPointer)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full flex items-center gap-2.5 rounded-lg border bg-background px-3 py-2.5 text-sm transition-all",
          open
            ? "border-primary ring-2 ring-primary/20"
            : "border-input hover:border-muted-foreground/40",
        )}
      >
        {selected ? (
          <>
            <MemberAvatar initials={memberInitials(selected)} />
            <span className="flex-1 text-left font-medium">
              {selected.user.name ?? selected.user.email}
            </span>
            {selected.user.name && (
              <span className="text-xs text-muted-foreground hidden sm:block">
                {selected.user.email}
              </span>
            )}
          </>
        ) : (
          <>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/30">
              <User className="h-3.5 w-3.5 text-muted-foreground/40" />
            </div>
            <span className="flex-1 text-left text-muted-foreground">Unassigned</span>
          </>
        )}
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 z-20 bg-background border border-border rounded-lg shadow-lg overflow-hidden">
          {/* Unassigned row */}
          <button
            type="button"
            onClick={() => {
              onChange(UNASSIGNED)
              setOpen(false)
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-muted/60 transition-colors"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/30">
              <User className="h-3.5 w-3.5 text-muted-foreground/40" />
            </div>
            <span className="flex-1 text-left text-muted-foreground">Unassigned</span>
            {value === UNASSIGNED && (
              <Check className="h-3.5 w-3.5 text-primary shrink-0" />
            )}
          </button>

          {members.length > 0 && (
            <div className="mx-3 border-t border-border" />
          )}

          <div className="max-h-48 overflow-y-auto">
            {members.map((m) => (
              <button
                key={m.userId}
                type="button"
                onClick={() => {
                  onChange(m.userId)
                  setOpen(false)
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-muted/60 transition-colors"
              >
                <MemberAvatar initials={memberInitials(m)} />
                <div className="flex-1 text-left min-w-0">
                  <p className="font-medium truncate">{m.user.name ?? m.user.email}</p>
                  {m.user.name && (
                    <p className="text-xs text-muted-foreground truncate">{m.user.email}</p>
                  )}
                </div>
                {value === m.userId && (
                  <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  contractId: string
  obligation: Obligation | null
  members: OrgMember[]
  onSaved: (obligation: Obligation) => void
}

export function ObligationSheet({
  open,
  onOpenChange,
  contractId,
  obligation,
  members,
  onSaved,
}: Props) {
  const t = useTranslations("obligations")
  const PRIORITY_OPTIONS: { value: ObligationPriority; label: string; dot: string; pill: string }[] = [
    { value: "LOW",    label: t("priority.LOW"),    ...PRIORITY_STYLE.LOW },
    { value: "MEDIUM", label: t("priority.MEDIUM"), ...PRIORITY_STYLE.MEDIUM },
    { value: "HIGH",   label: t("priority.HIGH"),   ...PRIORITY_STYLE.HIGH },
  ]

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
      <SheetContent className="flex flex-col w-full gap-0 p-0 sm:max-w-lg">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border shrink-0">
          <div>
            <p className="text-[15px] font-semibold text-foreground">
              {isEditing ? "Edit Obligation" : "New Obligation"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isEditing
                ? "Update the details below and save."
                : "Track a commitment or deliverable from this contract."}
            </p>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">

          {/* Title */}
          <div>
            <SectionLabel icon={Type} label="Title" required />
            <Input
              value={form.title}
              maxLength={300}
              onChange={(e) => update("title", e.target.value)}
              placeholder="e.g. Submit quarterly compliance report"
              className="h-10 text-sm"
            />
          </div>

          {/* Description */}
          <div>
            <SectionLabel icon={AlignLeft} label="Description" />
            <Textarea
              rows={3}
              value={form.description}
              maxLength={2000}
              onChange={(e) => update("description", e.target.value)}
              placeholder="Optional context for whoever owns this obligation…"
              className="text-sm resize-none"
            />
          </div>

          {/* Priority */}
          <div>
            <SectionLabel icon={Tag} label="Priority" />
            <div className="flex gap-2">
              {PRIORITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  data-active={form.priority === opt.value}
                  onClick={() => update("priority", opt.value)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 rounded-lg border py-2.5 text-xs font-semibold transition-all",
                    opt.pill,
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", opt.dot)} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-border/60" />

          {/* Due date */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <SectionLabel icon={CalendarDays} label="Due Date" required />
              <Input
                type="date"
                value={form.dueDate}
                onChange={(e) => update("dueDate", e.target.value)}
                className="h-10 text-sm"
              />
            </div>
            <div>
              <SectionLabel icon={Bell} label="Remind me" />
              <div className="flex gap-1.5">
                {REMINDER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => update("reminderDays", opt.value)}
                    className={cn(
                      "flex-1 rounded-lg border py-2 text-xs font-medium transition-all",
                      form.reminderDays === opt.value
                        ? "border-primary bg-primary/5 text-primary shadow-sm"
                        : "border-input bg-background text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {obligation?.reminderSentAt && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Reminder sent{" "}
                  {new Date(obligation.reminderSentAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              )}
            </div>
          </div>

          <div className="border-t border-border/60" />

          {/* Assignee */}
          <div>
            <SectionLabel icon={User} label="Assignee" />
            <AssigneePicker
              value={form.assigneeId}
              members={members}
              onChange={(id) => update("assigneeId", id)}
            />
          </div>

          {/* Clause reference */}
          <div>
            <SectionLabel icon={Bookmark} label="Clause Reference" />
            <Input
              value={form.clauseReference}
              maxLength={200}
              onChange={(e) => update("clauseReference", e.target.value)}
              placeholder="e.g. Section 4.2"
              className="h-10 text-sm"
            />
          </div>

        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-border shrink-0 bg-muted/30">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="min-w-[80px]"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={saving}
            className="min-w-[120px]"
          >
            {saving ? "Saving…" : isEditing ? "Save Changes" : "Create Obligation"}
          </Button>
        </div>

      </SheetContent>
    </Sheet>
  )
}

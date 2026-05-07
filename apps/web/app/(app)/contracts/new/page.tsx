"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
  Sparkles,
  CheckCircle2,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { FileUploadZone } from "@/components/file-upload-zone"
import { Folder, Tag } from "@/lib/types"
import { cn } from "@/lib/utils"

// ─── Constants ────────────────────────────────────────────────────────────────

const CONTRACT_TYPES = ["NDA", "MSA", "SOW", "EMPLOYMENT", "VENDOR", "CUSTOMER", "OTHER"] as const
const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "OTHER"] as const

const STEPS = [
  { number: 1, label: "Upload" },
  { number: 2, label: "Review" },
  { number: 3, label: "Organize" },
]

const EXTRACTABLE_FIELDS = [
  { key: "contractType",     label: "Contract Type",         type: "contractType_select" },
  { key: "counterpartyName", label: "Counterparty",          type: "text" },
  { key: "startDate",        label: "Start Date",            type: "date" },
  { key: "endDate",          label: "End Date",              type: "date" },
  { key: "renewalDate",      label: "Renewal Date",          type: "date" },
  { key: "value",            label: "Contract Value",        type: "number" },
  { key: "currency",         label: "Currency",              type: "currency_select" },
  { key: "autoRenewal",      label: "Auto-Renewal",          type: "boolean" },
  { key: "governingLaw",     label: "Governing Law",         type: "text" },
  { key: "noticePeriodDays", label: "Notice Period (days)",  type: "number" },
] as const

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS  = 40_000

// ─── Types ────────────────────────────────────────────────────────────────────

interface AIExtraction {
  id: string
  field: string
  rawValue: string | null
  confidence: number
  status: "pending" | "accepted" | "rejected"
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function titleCaseFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

function formatConfidence(score: number): string {
  return `${Math.round(score * 100)}%`
}

// ─── Inline field editor ──────────────────────────────────────────────────────

interface FieldEditorProps {
  fieldKey: string
  fieldType: string
  value: string
  onSave: (val: string) => void
  onCancel: () => void
}

function FieldEditor({ fieldKey, fieldType, value, onSave, onCancel }: FieldEditorProps) {
  const [draft, setDraft] = useState(value)

  if (fieldType === "contractType_select") {
    return (
      <div className="flex items-center gap-2">
        <Select value={draft} onValueChange={(v) => { if (v) setDraft(v) }}>
          <SelectTrigger className="h-7 text-xs w-36">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            {CONTRACT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          onClick={() => onSave(draft)}
          className="text-xs text-indigo-600 hover:underline font-medium"
        >
          Save
        </button>
        <button onClick={onCancel} className="text-xs text-zinc-500 hover:underline">
          Cancel
        </button>
      </div>
    )
  }

  if (fieldType === "currency_select") {
    return (
      <div className="flex items-center gap-2">
        <Select value={draft} onValueChange={(v) => { if (v) setDraft(v) }}>
          <SelectTrigger className="h-7 text-xs w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          onClick={() => onSave(draft)}
          className="text-xs text-indigo-600 hover:underline font-medium"
        >
          Save
        </button>
        <button onClick={onCancel} className="text-xs text-zinc-500 hover:underline">
          Cancel
        </button>
      </div>
    )
  }

  if (fieldType === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <Switch
          checked={draft === "true"}
          onCheckedChange={(v) => setDraft(v ? "true" : "false")}
        />
        <span className="text-xs text-zinc-600">{draft === "true" ? "Yes" : "No"}</span>
        <button
          onClick={() => onSave(draft)}
          className="text-xs text-indigo-600 hover:underline font-medium"
        >
          Save
        </button>
        <button onClick={onCancel} className="text-xs text-zinc-500 hover:underline">
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type={fieldType === "date" ? "date" : fieldType === "number" ? "number" : "text"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="h-7 text-xs w-40"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(draft)
          if (e.key === "Escape") onCancel()
        }}
      />
      <button
        onClick={() => onSave(draft)}
        className="text-xs text-indigo-600 hover:underline font-medium"
      >
        Save
      </button>
      <button onClick={onCancel} className="text-xs text-zinc-500 hover:underline">
        Cancel
      </button>
    </div>
  )
}

// ─── Manual field input (no AI value) ────────────────────────────────────────

interface ManualFieldInputProps {
  fieldKey: string
  fieldType: string
  value: string
  onChange: (val: string) => void
}

function ManualFieldInput({ fieldType, value, onChange }: ManualFieldInputProps) {
  if (fieldType === "contractType_select") {
    return (
      <Select value={value || ""} onValueChange={(v) => { if (v) onChange(v) }}>
        <SelectTrigger className="h-7 text-xs w-40">
          <SelectValue placeholder="Select type" />
        </SelectTrigger>
        <SelectContent>
          {CONTRACT_TYPES.map((t) => (
            <SelectItem key={t} value={t}>{t}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (fieldType === "currency_select") {
    return (
      <Select value={value || ""} onValueChange={(v) => { if (v) onChange(v) }}>
        <SelectTrigger className="h-7 text-xs w-24">
          <SelectValue placeholder="Select" />
        </SelectTrigger>
        <SelectContent>
          {CURRENCIES.map((c) => (
            <SelectItem key={c} value={c}>{c}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (fieldType === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <Switch
          checked={value === "true"}
          onCheckedChange={(v) => onChange(v ? "true" : "false")}
        />
        <span className="text-xs text-zinc-500">{value === "true" ? "Yes" : "No"}</span>
      </div>
    )
  }

  return (
    <Input
      type={fieldType === "date" ? "date" : fieldType === "number" ? "number" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 text-xs w-40"
      placeholder="Enter value…"
    />
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NewContractPage() {
  const router = useRouter()

  // ── Step state ──────────────────────────────────────────────────────────────
  const [step, setStep] = useState<1 | "analyzing" | 2 | 3>(1)
  const [loading, setLoading] = useState(false)

  // ── Step 1 state ─────────────────────────────────────────────────────────────
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")

  // ── Contract created in step 1 ───────────────────────────────────────────────
  const [contractId, setContractId] = useState<string | null>(null)

  // ── AI extractions + per-field tracking ──────────────────────────────────────
  const [extractions, setExtractions] = useState<AIExtraction[]>([])
  // fieldValues: keyed by field name; current display value (from AI or manual)
  // undefined = cleared by user (no value), "" = empty manual entry
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  // fieldCleared: fields explicitly cleared by the user
  const [fieldCleared, setFieldCleared] = useState<Set<string>>(new Set())
  // fieldEditing: field currently being edited inline
  const [fieldEditing, setFieldEditing] = useState<string | null>(null)

  // ── Step 3 state ─────────────────────────────────────────────────────────────
  const [folderId, setFolderId] = useState("")
  const [folders, setFolders] = useState<Folder[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set())
  const [newTagName, setNewTagName] = useState("")

  // ── Polling refs ──────────────────────────────────────────────────────────────
  const pollTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollStartRef      = useRef<number>(0)
  const pollActiveRef     = useRef(false)
  // Track the last file that was successfully uploaded so we don't re-upload on Back → Continue
  const lastUploadedFileRef = useRef<File | null>(null)

  // ── Fetch folders + tags once ─────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/folders").then(r => r.json()).then(d => setFolders(Array.isArray(d) ? d : [])).catch(() => {})
    fetch("/api/tags").then(r => r.json()).then(d => setTags(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  // ── Cleanup polling on unmount ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      pollActiveRef.current = false
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [])

  // ── Polling logic ─────────────────────────────────────────────────────────────
  const startPolling = useCallback((id: string) => {
    pollActiveRef.current = true
    pollStartRef.current = Date.now()

    function tick() {
      if (!pollActiveRef.current) return

      const elapsed = Date.now() - pollStartRef.current
      if (elapsed >= POLL_TIMEOUT_MS) {
        // Graceful degradation — advance to review with no extractions
        setStep(2)
        return
      }

      fetch(`/api/contracts/${id}/extractions`)
        .then((r) => {
          if (!r.ok) throw new Error("fetch failed")
          return r.json()
        })
        .then((data: { extractions: AIExtraction[] }) => {
          if (!pollActiveRef.current) return
          const found = Array.isArray(data.extractions) ? data.extractions : []
          if (found.length > 0) {
            pollActiveRef.current = false
            // Pre-populate fieldValues from AI rawValues
            const vals: Record<string, string> = {}
            for (const ex of found) {
              if (ex.rawValue !== null) vals[ex.field] = ex.rawValue
            }
            setExtractions(found)
            setFieldValues(vals)
            setStep(2)
          } else {
            // Schedule next tick
            pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS)
          }
        })
        .catch(() => {
          if (!pollActiveRef.current) return
          pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS)
        })
    }

    // Start first tick after one interval
    pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS)
  }, [])

  // ── Step 1 handlers ───────────────────────────────────────────────────────────

  function handleFileSelect(f: File) {
    setFile(f)
    if (!title) setTitle(titleCaseFromFilename(f.name))
  }

  async function handleStep1Continue() {
    if (!title.trim()) return
    setLoading(true)
    try {
      let currentContractId = contractId

      if (currentContractId) {
        // Contract already created (user went Back from step 2) — just update the title
        await fetch(`/api/contracts/${currentContractId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title.trim() }),
        }).catch(() => {})
      } else {
        // First time through — create the contract
        const createRes = await fetch("/api/contracts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title.trim() }),
        })
        if (!createRes.ok) {
          const err = await createRes.json().catch(() => ({}))
          throw new Error((err as { error?: string }).error ?? "Failed to create contract")
        }
        const contract = await createRes.json() as { id: string }
        currentContractId = contract.id
        setContractId(contract.id)
      }

      // Upload file only if there's a file AND it hasn't been uploaded before
      // (user may have gone Back without changing the file — skip re-upload)
      const fileIsNew = file !== null && file !== lastUploadedFileRef.current

      if (file && fileIsNew) {
        const fd = new FormData()
        fd.append("file", file)
        const uploadRes = await fetch(`/api/contracts/${currentContractId}/upload`, {
          method: "POST",
          body: fd,
        })
        if (!uploadRes.ok) {
          const uploadErr = await uploadRes.text().catch(() => "Upload failed")
          toast.error(`File upload failed: ${uploadErr}. Continuing without AI extraction.`)
          // Clear any stale extraction state
          setExtractions([])
          setFieldValues({})
          setFieldCleared(new Set())
          setStep(2)
          return
        }
        lastUploadedFileRef.current = file
      }

      // Clear previous extraction state so step 2 is always fresh
      setExtractions([])
      setFieldValues({})
      setFieldCleared(new Set())
      setFieldEditing(null)

      if (file) {
        // File exists (new or previously uploaded) — poll for AI extractions
        setStep("analyzing")
        startPolling(currentContractId!)
      } else {
        // No file — skip straight to manual review
        setStep(2)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create contract")
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2 — Review helpers ───────────────────────────────────────────────────

  function acceptAll() {
    const vals: Record<string, string> = {}
    for (const ex of extractions) {
      if (ex.rawValue !== null) vals[ex.field] = ex.rawValue
    }
    setFieldValues(vals)
    setFieldCleared(new Set())
  }

  function clearField(fieldKey: string) {
    setFieldValues((prev) => {
      const next = { ...prev }
      delete next[fieldKey]
      return next
    })
    setFieldCleared((prev) => { const s = new Set(prev); s.add(fieldKey); return s })
    setFieldEditing(null)
  }

  function saveFieldEdit(fieldKey: string, newVal: string) {
    setFieldValues((prev) => ({ ...prev, [fieldKey]: newVal }))
    setFieldCleared((prev) => {
      const next = new Set(prev)
      next.delete(fieldKey)
      return next
    })
    setFieldEditing(null)
  }

  function setManualValue(fieldKey: string, val: string) {
    setFieldValues((prev) => ({ ...prev, [fieldKey]: val }))
  }

  async function handleStep2Continue() {
    if (!contractId) return
    setLoading(true)
    try {
      // Process AI extraction records
      for (const ex of extractions) {
        if (fieldCleared.has(ex.field)) {
          // User cleared it — reject
          await fetch(`/api/contracts/${contractId}/extractions`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "reject", extractionId: ex.id }),
          }).catch(() => {})
        } else {
          const currentVal = fieldValues[ex.field]
          if (currentVal !== undefined && currentVal !== ex.rawValue) {
            // User edited the value
            await fetch(`/api/contracts/${contractId}/extractions`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "edit", extractionId: ex.id, newValue: currentVal }),
            }).catch(() => {})
          } else if (currentVal !== undefined) {
            // Unchanged AI value — accept
            await fetch(`/api/contracts/${contractId}/extractions`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "accept", extractionId: ex.id }),
            }).catch(() => {})
          }
        }
      }

      // Collect manually entered values (fields with no extraction record)
      const extractedFields = new Set(extractions.map((e) => e.field))
      const manualPatch: Record<string, unknown> = {}

      for (const f of EXTRACTABLE_FIELDS) {
        if (extractedFields.has(f.key)) continue
        const raw = fieldValues[f.key]
        if (!raw) continue

        if (f.type === "date") {
          manualPatch[f.key] = raw
        } else if (f.type === "number") {
          if (f.key === "noticePeriodDays") manualPatch[f.key] = parseInt(raw, 10)
          else manualPatch[f.key] = parseFloat(raw)
        } else if (f.type === "boolean") {
          manualPatch[f.key] = raw === "true"
        } else {
          manualPatch[f.key] = raw
        }
      }

      if (Object.keys(manualPatch).length > 0) {
        await fetch(`/api/contracts/${contractId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(manualPatch),
        }).catch(() => {})
      }

      setStep(3)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save review")
    } finally {
      setLoading(false)
    }
  }

  // ── Step 3 helpers ────────────────────────────────────────────────────────────

  function toggleTag(id: string) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function addNewTag() {
    if (!newTagName.trim()) return
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTagName.trim() }),
      })
      if (res.ok) {
        const tag: Tag = await res.json()
        setTags((prev) => [...prev, tag])
        setSelectedTagIds((prev) => { const s = new Set(prev); s.add(tag.id); return s })
        setNewTagName("")
      }
    } catch {}
  }

  async function handleFinish() {
    if (!contractId) return
    setLoading(true)
    try {
      const patch: Record<string, unknown> = {}
      if (folderId) patch.folderId = folderId
      if (selectedTagIds.size > 0) patch.tagIds = Array.from(selectedTagIds)

      if (Object.keys(patch).length > 0) {
        const res = await fetch(`/api/contracts/${contractId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error((err as { error?: string }).error ?? "Failed to update contract")
        }
      }

      toast.success("Contract created")
      router.push(`/contracts/${contractId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to finish")
    } finally {
      setLoading(false)
    }
  }

  // ── Step indicator numeric value (analyzing counts as step 2 in progress bar) ─
  const stepNumber = step === "analyzing" ? 2 : step

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col items-center overflow-auto p-6">
      {/* Back / Cancel */}
      <div className="w-full max-w-2xl">
        <button
          disabled={step === "analyzing"}
          onClick={() => {
            if (step === "analyzing") return
            if (step === 1) router.back()
            else if (step === 2) {
              // Stop any active polling and wipe extraction state so step 2 re-enters fresh
              pollActiveRef.current = false
              if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
              setExtractions([])
              setFieldValues({})
              setFieldCleared(new Set())
              setFieldEditing(null)
              setStep(1)
            }
            else if (step === 3) setStep(2)
          }}
          className={cn(
            "flex items-center gap-1.5 text-sm transition-colors",
            step === "analyzing"
              ? "cursor-not-allowed text-zinc-300"
              : "text-zinc-500 hover:text-zinc-900",
          )}
        >
          <ChevronLeft className="size-4" />
          {step === 1 ? "Cancel" : "Back"}
        </button>
      </div>

      {/* Step progress bar */}
      <div className="mt-6 flex items-center">
        {STEPS.map((s, i) => (
          <div key={s.number} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  "flex size-8 items-center justify-center rounded-full text-sm font-medium",
                  stepNumber === s.number || stepNumber > s.number
                    ? "bg-indigo-600 text-white"
                    : "bg-zinc-200 text-zinc-600",
                )}
              >
                {s.number}
              </div>
              <span
                className={cn(
                  "text-xs font-medium",
                  stepNumber === s.number ? "text-zinc-900" : "text-zinc-500",
                )}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  "mx-3 mb-5 h-px w-20",
                  stepNumber > s.number ? "bg-indigo-600" : "bg-zinc-200",
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="mt-6 w-full max-w-2xl">

        {/* ── STEP 1: Upload ─────────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="rounded-lg border border-zinc-200 bg-white p-6 space-y-5">
            <div>
              <p className="text-sm font-medium text-zinc-900">Upload Contract</p>
              <p className="mt-0.5 text-sm text-zinc-500">
                Upload your document — ClauseFlow AI will extract fields automatically.
              </p>
            </div>

            <FileUploadZone onFileSelect={handleFileSelect} />

            <div className="space-y-1.5">
              <Label htmlFor="title">Contract Name</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Acme Corp NDA"
                autoFocus={!file}
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!title.trim() || loading}
                onClick={handleStep1Continue}
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Uploading…
                  </>
                ) : (
                  <>
                    Continue
                    <ChevronRight className="size-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ── ANALYZING: interstitial overlay (rendered as step 2 card) ─────── */}
        {step === "analyzing" && (
          <div className="rounded-lg border border-zinc-200 bg-white p-6">
            <div className="flex flex-col items-center justify-center py-14 gap-4 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-indigo-50">
                <Loader2 className="size-7 text-indigo-600 animate-spin" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-900">Analyzing document…</p>
                <p className="mt-1 text-sm text-zinc-500">
                  ClauseFlow AI is reading your contract
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2: Review AI Extractions ────────────────────────────────── */}
        {step === 2 && (
          <div className="rounded-lg border border-zinc-200 bg-white p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-900">Review Extracted Fields</p>
                <p className="mt-0.5 text-sm text-zinc-500">
                  Confirm, edit, or clear values detected by AI. Fill in anything missed.
                </p>
              </div>
              {extractions.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={acceptAll}
                  className="shrink-0 ml-4"
                >
                  Accept All
                </Button>
              )}
            </div>

            <div className="divide-y divide-zinc-100">
              {EXTRACTABLE_FIELDS.map((f) => {
                const extraction = extractions.find((e) => e.field === f.key)
                const hasAI = extraction !== undefined && extraction.rawValue !== null
                const isCleared = fieldCleared.has(f.key)
                const currentVal = fieldValues[f.key]
                const isEditing = fieldEditing === f.key

                return (
                  <div key={f.key} className="flex items-center justify-between py-3 gap-4 min-h-[52px]">
                    {/* Label */}
                    <div className="flex items-center gap-1.5 min-w-[140px]">
                      {hasAI && !isCleared && (
                        <Sparkles className="size-3.5 text-indigo-400 shrink-0" />
                      )}
                      <span className="text-sm text-zinc-700">{f.label}</span>
                    </div>

                    {/* Value area */}
                    <div className="flex items-center gap-2 ml-auto">
                      {hasAI && !isCleared ? (
                        // AI found a value and user hasn't cleared it
                        isEditing ? (
                          <FieldEditor
                            fieldKey={f.key}
                            fieldType={f.type}
                            value={currentVal ?? extraction.rawValue ?? ""}
                            onSave={(v) => saveFieldEdit(f.key, v)}
                            onCancel={() => setFieldEditing(null)}
                          />
                        ) : (
                          <>
                            {/* Confidence badge */}
                            <span className="text-xs text-zinc-400">
                              {formatConfidence(extraction.confidence)}
                            </span>
                            {/* Value chip — click to edit */}
                            <button
                              type="button"
                              onClick={() => setFieldEditing(f.key)}
                              className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors max-w-[200px] truncate"
                              title={currentVal ?? extraction.rawValue ?? ""}
                            >
                              {currentVal ?? extraction.rawValue}
                            </button>
                            {/* Edit text link */}
                            <button
                              type="button"
                              onClick={() => setFieldEditing(f.key)}
                              className="text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
                            >
                              Edit
                            </button>
                            {/* Accept icon (always green = pre-accepted) */}
                            <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                            {/* Clear icon */}
                            <button
                              type="button"
                              onClick={() => clearField(f.key)}
                              className="text-zinc-300 hover:text-red-400 transition-colors"
                              title="Clear value"
                            >
                              <XCircle className="size-4" />
                            </button>
                          </>
                        )
                      ) : (
                        // No AI value, or user cleared it
                        isEditing ? (
                          <FieldEditor
                            fieldKey={f.key}
                            fieldType={f.type}
                            value={currentVal ?? ""}
                            onSave={(v) => saveFieldEdit(f.key, v)}
                            onCancel={() => setFieldEditing(null)}
                          />
                        ) : (
                          <div className="flex items-center gap-2">
                            {!hasAI && !isCleared && (
                              <span className="text-xs text-zinc-400 italic mr-1">Not detected</span>
                            )}
                            {isCleared && (
                              <span className="text-xs text-zinc-400 italic mr-1">Cleared</span>
                            )}
                            <ManualFieldInput
                              fieldKey={f.key}
                              fieldType={f.type}
                              value={currentVal ?? ""}
                              onChange={(v) => setManualValue(f.key, v)}
                            />
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setStep(1)}>
                <ChevronLeft className="size-4" />
                Back
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={loading}
                onClick={handleStep2Continue}
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    Continue
                    <ChevronRight className="size-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Organize ─────────────────────────────────────────────── */}
        {step === 3 && (
          <div className="rounded-lg border border-zinc-200 bg-white p-6 space-y-5">
            <div>
              <p className="text-sm font-medium text-zinc-900">Organize</p>
              <p className="mt-0.5 text-sm text-zinc-500">
                Add this contract to a folder and tag it for easy discovery.
              </p>
            </div>

            {/* Folder */}
            <div className="space-y-1.5">
              <Label htmlFor="folder">Folder</Label>
              <Select value={folderId || "none"} onValueChange={(v) => setFolderId(!v || v === "none" ? "" : v)}>
                <SelectTrigger id="folder" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No folder</SelectItem>
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label>Tags</Label>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
                        selectedTagIds.has(tag.id)
                          ? "bg-indigo-600 text-white"
                          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200",
                      )}
                    >
                      {tag.name}
                      {selectedTagIds.has(tag.id) && (
                        <X className="ml-1 size-2.5" />
                      )}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="Add new tag..."
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewTag() } }}
                  className="h-7 text-xs flex-1"
                />
                <Button type="button" variant="outline" size="sm" onClick={addNewTag} disabled={!newTagName.trim()}>
                  Add
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setStep(2)}>
                <ChevronLeft className="size-4" />
                Back
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={loading}
                onClick={handleFinish}
              >
                {loading ? "Creating…" : "Create contract"}
              </Button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

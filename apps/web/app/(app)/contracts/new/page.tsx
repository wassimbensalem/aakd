"use client"

import { useState, useRef, useCallback, DragEvent, ChangeEvent } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Upload, Sparkles, FileText, Loader2 } from "lucide-react"
import Link from "next/link"
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
import { cn } from "@/lib/utils"

// ---- Constants ----

const CONTRACT_TYPES = [
  { value: "NDA", label: "NDA" },
  { value: "MSA", label: "Master Service Agreement" },
  { value: "SOW", label: "Statement of Work" },
  { value: "EMPLOYMENT", label: "Employment" },
  { value: "VENDOR", label: "Vendor" },
  { value: "CUSTOMER", label: "Customer" },
  { value: "OTHER", label: "Other" },
] as const

const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "OTHER"] as const

// ---- Types ----

type PageState = "upload" | "extracting" | "review"

interface FormData {
  title: string
  contractType: string
  counterpartyName: string
  startDate: string
  endDate: string
  value: string
  currency: string
  paymentTerms: string
  autoRenewal: boolean
  governingLaw: string
  description: string
}

const defaultFormData: FormData = {
  title: "",
  contractType: "",
  counterpartyName: "",
  startDate: "",
  endDate: "",
  value: "",
  currency: "USD",
  paymentTerms: "",
  autoRenewal: false,
  governingLaw: "",
  description: "",
}

interface ExtractionResult {
  title?: string | null
  contractType?: string | null
  counterpartyName?: string | null
  startDate?: string | null
  endDate?: string | null
  value?: number | null
  currency?: string | null
  paymentTerms?: string | null
  governingLaw?: string | null
  autoRenewal?: boolean
  description?: string | null
  confidence?: Record<string, number>
  error?: string
  partial?: boolean
}

// ---- Utility ----

function titleCaseFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

// ---- Confidence bar ----

function ConfidenceBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100)
  const color =
    pct >= 90
      ? "bg-emerald-500"
      : pct >= 70
        ? "bg-amber-400"
        : "bg-rose-400"

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground capitalize">
          {label.replace(/([A-Z])/g, " $1").trim()}
        </span>
        <span className="text-xs font-medium text-foreground">{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ---- Upload Screen ----

function UploadScreen({
  onFileSelected,
}: {
  onFileSelected: (file: File) => void
}) {
  const [isDragging, setIsDragging] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(
    (file: File) => {
      setPendingFile(file)
    },
    [],
  )

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="w-full max-w-xl">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "border-2 border-dashed rounded-xl p-16 text-center transition-colors cursor-default",
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border bg-card hover:border-primary/50 hover:bg-muted/30",
          )}
        >
          <Upload className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground">
            Drop your contract here
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            PDF or DOCX · Max 50 MB · AI will extract key fields automatically
          </p>

          {pendingFile ? (
            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-2.5">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium truncate max-w-[260px]">
                  {pendingFile.name}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatFileSize(pendingFile.size)}
                </span>
              </div>
              <Button
                onClick={() => onFileSelected(pendingFile)}
                className="w-full"
              >
                Analyze with AI →
              </Button>
            </div>
          ) : (
            <Button
              variant="default"
              className="mt-6"
              onClick={() => inputRef.current?.click()}
            >
              Browse Files
            </Button>
          )}

          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx"
            className="hidden"
            onChange={handleInputChange}
          />
        </div>

        {pendingFile && (
          <p
            className="mt-3 text-center text-xs text-muted-foreground underline cursor-pointer"
            onClick={() => {
              setPendingFile(null)
              if (inputRef.current) inputRef.current.value = ""
            }}
          >
            Remove file
          </p>
        )}
      </div>
    </div>
  )
}

// ---- Extracting Screen ----

function ExtractingScreen() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 animate-pulse">
        <Sparkles className="h-8 w-8 text-primary" />
      </div>
      <div className="text-center space-y-1.5">
        <h2 className="text-xl font-semibold text-foreground">
          Analyzing your contract...
        </h2>
        <p className="text-sm text-muted-foreground">
          AI is extracting key fields. This takes a few seconds.
        </p>
      </div>
      <div className="flex gap-1.5 mt-2">
        <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce [animation-delay:-0.3s]" />
        <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce [animation-delay:-0.15s]" />
        <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce" />
      </div>
    </div>
  )
}

// ---- Review Screen ----

function ReviewScreen({
  file,
  formData,
  confidence,
  submitting,
  onFormChange,
  onToggleRenewal,
  onBack,
  onSubmit,
  onChangeFile,
}: {
  file: File
  formData: FormData
  confidence: Record<string, number>
  submitting: boolean
  onFormChange: (key: keyof FormData, value: string) => void
  onToggleRenewal: () => void
  onBack: () => void
  onSubmit: () => void
  onChangeFile: () => void
}) {
  const fileExt = file.name.split(".").pop()?.toUpperCase() ?? "FILE"

  return (
    <div className="max-w-5xl mx-auto px-4 pb-24">
      {/* Two-column layout */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-6 mt-6">
        {/* ---- Left column: editable form ---- */}
        <div className="space-y-6">
          {/* Basic Information */}
          <section className="rounded-xl border border-border bg-card p-6 space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Basic Information
            </h3>

            <div className="space-y-1.5">
              <Label htmlFor="title">
                Contract Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => onFormChange("title", e.target.value)}
                placeholder="Service Agreement Q1 2026"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contractType">Contract Type</Label>
              <Select
                value={formData.contractType}
                onValueChange={(v) => onFormChange("contractType", v ?? "")}
              >
                <SelectTrigger id="contractType" className="w-full">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => onFormChange("description", e.target.value)}
                placeholder="Brief summary of this contract..."
                rows={3}
              />
            </div>
          </section>

          {/* Parties */}
          <section className="rounded-xl border border-border bg-card p-6 space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Parties
            </h3>

            <div className="space-y-1.5">
              <Label htmlFor="counterpartyName">Counterparty Name</Label>
              <Input
                id="counterpartyName"
                value={formData.counterpartyName}
                onChange={(e) => onFormChange("counterpartyName", e.target.value)}
                placeholder="Acme Corporation"
              />
            </div>
          </section>

          {/* Timeline */}
          <section className="rounded-xl border border-border bg-card p-6 space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Timeline
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => onFormChange("startDate", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => onFormChange("endDate", e.target.value)}
                />
              </div>
            </div>
          </section>

          {/* Financial */}
          <section className="rounded-xl border border-border bg-card p-6 space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Financial
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="value">Contract Value</Label>
                <Input
                  id="value"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.value}
                  onChange={(e) => onFormChange("value", e.target.value)}
                  placeholder="50000"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="currency">Currency</Label>
                <Select
                  value={formData.currency}
                  onValueChange={(v) => onFormChange("currency", v ?? "USD")}
                >
                  <SelectTrigger id="currency" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="paymentTerms">Payment Terms</Label>
              <Input
                id="paymentTerms"
                value={formData.paymentTerms}
                onChange={(e) => onFormChange("paymentTerms", e.target.value)}
                placeholder="Net 30"
              />
            </div>

            {/* Auto-Renewal toggle */}
            <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Auto-Renewal</p>
                <p className="text-xs text-muted-foreground">
                  Contract renews automatically at expiry
                </p>
              </div>
              <button
                type="button"
                onClick={onToggleRenewal}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none",
                  formData.autoRenewal ? "bg-primary" : "bg-muted",
                )}
                aria-label="Toggle auto-renewal"
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block size-4 rounded-full bg-white shadow-sm ring-0 transition-transform",
                    formData.autoRenewal ? "translate-x-4" : "translate-x-0",
                  )}
                />
              </button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="governingLaw">Governing Law</Label>
              <Input
                id="governingLaw"
                value={formData.governingLaw}
                onChange={(e) => onFormChange("governingLaw", e.target.value)}
                placeholder="State of Delaware"
              />
            </div>
          </section>
        </div>

        {/* ---- Right column: AI confidence sidebar ---- */}
        <div className="space-y-4">
          {/* AI Extraction card */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3 sticky top-6">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-semibold text-foreground">AI Extraction</span>
              <span className="ml-auto inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                Powered by AI
              </span>
            </div>

            {Object.keys(confidence).length > 0 ? (
              <div className="space-y-2.5 pt-1">
                {Object.entries(confidence).map(([field, val]) => (
                  <ConfidenceBar key={field} label={field} value={val} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground pt-1">
                No confidence data available.
              </p>
            )}

            <p className="text-xs text-muted-foreground pt-1 border-t border-border">
              Values pre-filled from your document. Review and correct as needed.
            </p>
          </div>

          {/* File card */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium truncate flex-1">{file.name}</span>
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-muted text-muted-foreground shrink-0">
                {fileExt}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
            <button
              type="button"
              onClick={onChangeFile}
              className="text-xs text-primary underline hover:no-underline"
            >
              Change file
            </button>
          </div>
        </div>
      </div>

      {/* ---- Bottom action bar ---- */}
      <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={submitting || !formData.title.trim()}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              "Create Contract"
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---- Main Page ----

export default function NewContractPage() {
  const router = useRouter()
  const [pageState, setPageState] = useState<PageState>("upload")
  const [file, setFile] = useState<File | null>(null)
  const [formData, setFormData] = useState<FormData>(defaultFormData)
  const [confidence, setConfidence] = useState<Record<string, number>>({})
  const [submitting, setSubmitting] = useState(false)

  function updateField(key: keyof FormData, value: string) {
    setFormData((prev) => ({ ...prev, [key]: value }))
  }

  function toggleRenewal() {
    setFormData((prev) => ({ ...prev, autoRenewal: !prev.autoRenewal }))
  }

  async function handleFileSelected(selectedFile: File) {
    setFile(selectedFile)
    setPageState("extracting")

    const fileNameWithoutExt = selectedFile.name.replace(/\.[^.]+$/, "")

    try {
      const fd = new globalThis.FormData()
      fd.append("file", selectedFile)

      const res = await fetch("/api/contracts/extract-preview", {
        method: "POST",
        body: fd,
        credentials: "include",
      })

      const extracted: ExtractionResult = await res.json()

      setFormData({
        title: extracted.title ?? titleCaseFromFilename(fileNameWithoutExt),
        contractType: extracted.contractType ?? "",
        counterpartyName: extracted.counterpartyName ?? "",
        startDate: extracted.startDate?.slice(0, 10) ?? "",
        endDate: extracted.endDate?.slice(0, 10) ?? "",
        value: extracted.value != null ? String(extracted.value) : "",
        currency: extracted.currency ?? "USD",
        paymentTerms: extracted.paymentTerms ?? "",
        autoRenewal: extracted.autoRenewal ?? false,
        governingLaw: extracted.governingLaw ?? "",
        description: extracted.description ?? "",
      })
      setConfidence(extracted.confidence ?? {})

      if (extracted.error) {
        toast.warning(
          extracted.partial
            ? "AI extraction partially failed — fill in missing fields manually."
            : "AI extraction unavailable — please fill in fields manually.",
        )
      }
    } catch {
      // Network or parse error — degrade gracefully, still go to review
      toast.error("Could not reach AI extraction. Please fill in fields manually.")
      setFormData((prev) => ({
        ...prev,
        title: titleCaseFromFilename(fileNameWithoutExt),
      }))
      setConfidence({})
    }

    setPageState("review")
  }

  function handleChangeFile() {
    setFile(null)
    setFormData(defaultFormData)
    setConfidence({})
    setPageState("upload")
  }

  async function handleSubmit() {
    if (!formData.title.trim()) {
      toast.error("Contract title is required")
      return
    }

    setSubmitting(true)
    try {
      // Helper: only send a date if it's already in YYYY-MM-DD format (what the
      // API expects). AI-extracted dates may arrive in other formats — skip those
      // rather than causing a 422 validation failure.
      const isoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined

      const body: Record<string, unknown> = {
        title: formData.title.trim(),
        contractType: formData.contractType || undefined,
        counterpartyName: formData.counterpartyName || undefined,
        value: formData.value ? Number(formData.value) : undefined,
        // Normalise currency: "OTHER" is a UI-only placeholder; send "USD" instead
        currency: formData.currency === "OTHER" ? "USD" : (formData.currency || "USD"),
        startDate: formData.startDate ? isoDate(formData.startDate) : undefined,
        endDate: formData.endDate ? isoDate(formData.endDate) : undefined,
        governingLaw: formData.governingLaw || undefined,
        autoRenewal: formData.autoRenewal,
        notes: formData.description || undefined,
      }

      const res = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      })

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? "Failed to create contract")
      }

      const contract = (await res.json()) as { id: string }

      if (file) {
        const fd = new globalThis.FormData()
        fd.append("file", file)
        await fetch(`/api/contracts/${contract.id}/upload`, {
          method: "POST",
          body: fd,
          credentials: "include",
        })

        // Seed AIExtraction rows immediately from the Pass-1 (extract-preview)
        // data so the AI Extractions tab is populated the moment the user lands
        // on the contract detail page — no spinner needed.
        // The worker's ai_extract job will later enrich these rows with
        // sourceText / sourcePage via its own upsert (skipDuplicates + updateMany).
        const seedFields: Array<{ field: string; rawValue: string }> = [
          { field: "contractType",     rawValue: formData.contractType },
          { field: "counterpartyName", rawValue: formData.counterpartyName },
          { field: "startDate",        rawValue: formData.startDate },
          { field: "endDate",          rawValue: formData.endDate },
          { field: "value",            rawValue: formData.value },
          { field: "currency",         rawValue: formData.currency === "OTHER" ? "USD" : formData.currency },
          { field: "governingLaw",     rawValue: formData.governingLaw },
          { field: "autoRenewal",      rawValue: String(formData.autoRenewal) },
        ]
        const seedPayload = seedFields
          .filter(({ rawValue }) => rawValue !== "" && rawValue != null)
          .map(({ field, rawValue }) => ({
            field,
            rawValue,
            confidence: confidence[field] ?? 0,
          }))

        if (seedPayload.length > 0) {
          await fetch(`/api/contracts/${contract.id}/extractions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ extractions: seedPayload }),
            credentials: "include",
          }).catch(() => {
            // Non-critical — the worker will populate the tab anyway
          })
        }
      }

      toast.success("Contract created")
      // Invalidate the router cache so the dashboard reflects the new contract
      // immediately when the user navigates back.
      router.refresh()
      router.push(`/contracts/${contract.id}`)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create contract",
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen">
      {/* Page header */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link
            href="/contracts"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Contracts
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium text-foreground">New Contract</span>
        </div>
      </div>

      {/* Page content */}
      {pageState === "upload" && (
        <UploadScreen onFileSelected={handleFileSelected} />
      )}
      {pageState === "extracting" && <ExtractingScreen />}
      {pageState === "review" && file && (
        <ReviewScreen
          file={file}
          formData={formData}
          confidence={confidence}
          submitting={submitting}
          onFormChange={updateField}
          onToggleRenewal={toggleRenewal}
          onBack={handleChangeFile}
          onSubmit={handleSubmit}
          onChangeFile={handleChangeFile}
        />
      )}
    </div>
  )
}

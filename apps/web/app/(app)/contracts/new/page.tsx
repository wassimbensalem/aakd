"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Building2, Link as LinkIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FileUploadZone } from "@/components/file-upload-zone"
import { cn } from "@/lib/utils"

const CONTRACT_TYPES = [
  { value: "NDA", label: "NDA" },
  { value: "MSA", label: "Service Agreement" },
  { value: "SOW", label: "SaaS License" },
  { value: "EMPLOYMENT", label: "Employment" },
  { value: "OTHER", label: "Other" },
] as const

const CURRENCIES = ["USD", "EUR", "GBP", "CAD"] as const
const PAYMENT_TERMS = ["Net 30", "Net 60", "Net 90", "Immediate"] as const

const STEPS = [
  { label: "Basic Info" },
  { label: "Counterparty" },
  { label: "Terms" },
  { label: "Review" },
]

function titleCaseFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

interface FormData {
  title: string
  contractType: string
  startDate: string
  endDate: string
  assignee: string
  description: string
  counterpartyName: string
  counterpartyEmail: string
  counterpartyWebsite: string
  value: string
  currency: string
  paymentTerms: string
  autoRenewal: boolean
  noticePeriod: string
  governingLaw: string
}

const defaultFormData: FormData = {
  title: "",
  contractType: "",
  startDate: "",
  endDate: "",
  assignee: "",
  description: "",
  counterpartyName: "",
  counterpartyEmail: "",
  counterpartyWebsite: "",
  value: "",
  currency: "USD",
  paymentTerms: "Net 30",
  autoRenewal: false,
  noticePeriod: "",
  governingLaw: "",
}

// ---- Step Indicator ----
function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center justify-center mb-10">
      {STEPS.map((step, i) => {
        const completed = i < currentStep
        const active = i === currentStep
        return (
          <div key={i} className="flex items-center">
            {/* Connector before (not for first step) */}
            {i > 0 && (
              <div
                className={cn(
                  "h-px w-16 shrink-0",
                  i <= currentStep ? "bg-primary" : "bg-border",
                )}
              />
            )}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  "flex size-8 items-center justify-center rounded-full text-sm font-medium transition-colors",
                  completed && "bg-primary/20 text-primary",
                  active && "bg-primary text-primary-foreground",
                  !completed && !active && "bg-muted text-muted-foreground",
                )}
              >
                {completed ? <Check className="size-4" /> : i + 1}
              </div>
              <span
                className={cn(
                  "text-xs font-medium whitespace-nowrap",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {step.label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---- Step 1: Basic Info ----
function Step1({ data, onChange }: { data: FormData; onChange: (k: keyof FormData, v: string) => void }) {
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="title">
          Contract Title <span className="text-destructive">*</span>
        </Label>
        <Input
          id="title"
          value={data.title}
          onChange={(e) => onChange("title", e.target.value)}
          placeholder="Service Agreement Q1 2026"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contractType">Contract Type</Label>
        <Select value={data.contractType} onValueChange={(v) => onChange("contractType", v ?? "")}>
          <SelectTrigger id="contractType" className="w-full">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            {CONTRACT_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="startDate">Start Date</Label>
          <Input
            id="startDate"
            type="date"
            value={data.startDate}
            onChange={(e) => onChange("startDate", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="endDate">End Date</Label>
          <Input
            id="endDate"
            type="date"
            value={data.endDate}
            onChange={(e) => onChange("endDate", e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="assignee">Assignee</Label>
        <Input
          id="assignee"
          value={data.assignee}
          onChange={(e) => onChange("assignee", e.target.value)}
          placeholder="Assign to a team member..."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={data.description}
          onChange={(e) => onChange("description", e.target.value)}
          placeholder="Brief description of this contract..."
          rows={3}
        />
      </div>
    </div>
  )
}

// ---- Step 2: Counterparty ----
function Step2({ data, onChange }: { data: FormData; onChange: (k: keyof FormData, v: string) => void }) {
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="counterpartyName">Counterparty Name</Label>
        <Input
          id="counterpartyName"
          value={data.counterpartyName}
          onChange={(e) => onChange("counterpartyName", e.target.value)}
          placeholder="Acme Corporation"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="counterpartyEmail">Contact Email</Label>
        <Input
          id="counterpartyEmail"
          type="email"
          value={data.counterpartyEmail}
          onChange={(e) => onChange("counterpartyEmail", e.target.value)}
          placeholder="legal@acme.com"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="counterpartyWebsite">Company Website</Label>
        <Input
          id="counterpartyWebsite"
          type="url"
          value={data.counterpartyWebsite}
          onChange={(e) => onChange("counterpartyWebsite", e.target.value)}
          placeholder="https://acme.com"
        />
      </div>

      {/* CRM Link Panel */}
      <div className="rounded-[var(--radius)] border border-border bg-muted/30 p-4">
        <div className="flex items-center gap-2 mb-3">
          <LinkIcon className="size-3.5 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Link to CRM</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {/* HubSpot Card */}
          <div className="relative rounded-[var(--radius)] border border-border bg-card p-3 opacity-60">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex size-6 items-center justify-center rounded bg-orange-100">
                <Building2 className="size-3.5 text-orange-600" />
              </div>
              <span className="text-xs font-medium text-foreground">HubSpot</span>
            </div>
            <Input
              className="h-7 text-xs"
              placeholder="Search deals..."
              disabled
            />
            <Button size="sm" className="mt-2 h-7 w-full text-xs" disabled>
              Link Deal
            </Button>
            <span className="absolute right-2 top-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              Soon
            </span>
          </div>

          {/* Salesforce Card */}
          <div className="relative rounded-[var(--radius)] border border-border bg-card p-3 opacity-60">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex size-6 items-center justify-center rounded bg-blue-100">
                <Building2 className="size-3.5 text-blue-600" />
              </div>
              <span className="text-xs font-medium text-foreground">Salesforce</span>
            </div>
            <Input
              className="h-7 text-xs"
              placeholder="Search deals..."
              disabled
            />
            <Button size="sm" className="mt-2 h-7 w-full text-xs" disabled>
              Link Deal
            </Button>
            <span className="absolute right-2 top-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              Soon
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- Step 3: Terms ----
function Step3({
  data,
  onChange,
  onToggleRenewal,
}: {
  data: FormData
  onChange: (k: keyof FormData, v: string) => void
  onToggleRenewal: () => void
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5 col-span-2">
          <Label htmlFor="value">Contract Value</Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
            <Input
              id="value"
              type="number"
              min="0"
              step="0.01"
              value={data.value}
              onChange={(e) => onChange("value", e.target.value)}
              placeholder="50,000"
              className="pl-7"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="currency">Currency</Label>
          <Select value={data.currency} onValueChange={(v) => onChange("currency", v ?? "")}>
            <SelectTrigger id="currency" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="paymentTerms">Payment Terms</Label>
          <Select value={data.paymentTerms} onValueChange={(v) => onChange("paymentTerms", v ?? "")}>
            <SelectTrigger id="paymentTerms" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_TERMS.map((pt) => (
                <SelectItem key={pt} value={pt}>{pt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Auto-Renewal Toggle */}
      <div className="flex items-center justify-between rounded-[var(--radius)] border border-border px-4 py-3">
        <div>
          <p className="text-sm font-medium text-foreground">Auto-Renewal</p>
          <p className="text-xs text-muted-foreground">Contract renews automatically at expiry</p>
        </div>
        <button
          type="button"
          onClick={onToggleRenewal}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none",
            data.autoRenewal ? "bg-primary" : "bg-muted",
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block size-4 rounded-full bg-white shadow-sm ring-0 transition-transform",
              data.autoRenewal ? "translate-x-4" : "translate-x-0",
            )}
          />
        </button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="noticePeriod">Notice Period</Label>
        <Input
          id="noticePeriod"
          value={data.noticePeriod}
          onChange={(e) => onChange("noticePeriod", e.target.value)}
          placeholder="e.g. 90 days"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="governingLaw">Governing Law</Label>
        <Input
          id="governingLaw"
          value={data.governingLaw}
          onChange={(e) => onChange("governingLaw", e.target.value)}
          placeholder="e.g. State of Delaware"
        />
      </div>
    </div>
  )
}

// ---- Step 4: Review ----
function Step4({ data, file, onFileSelect }: { data: FormData; file: File | null; onFileSelect: (f: File) => void }) {
  function ReviewCard({ title, rows }: { title: string; rows: { label: string; value: string }[] }) {
    const nonEmpty = rows.filter((r) => r.value)
    if (nonEmpty.length === 0) return null
    return (
      <div className="rounded-[var(--radius)] border border-border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">{title}</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
          {nonEmpty.map((row) => (
            <div key={row.label}>
              <p className="text-xs text-muted-foreground">{row.label}</p>
              <p className="text-sm font-medium text-foreground mt-0.5">{row.value}</p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <ReviewCard
        title="Basic Info"
        rows={[
          { label: "Title", value: data.title },
          { label: "Contract Type", value: data.contractType },
          { label: "Start Date", value: data.startDate },
          { label: "End Date", value: data.endDate },
          { label: "Assignee", value: data.assignee },
          { label: "Description", value: data.description },
        ]}
      />

      <ReviewCard
        title="Counterparty"
        rows={[
          { label: "Name", value: data.counterpartyName },
          { label: "Email", value: data.counterpartyEmail },
          { label: "Website", value: data.counterpartyWebsite },
        ]}
      />

      <ReviewCard
        title="Terms"
        rows={[
          { label: "Contract Value", value: data.value ? `${data.currency} ${data.value}` : "" },
          { label: "Payment Terms", value: data.paymentTerms },
          { label: "Auto-Renewal", value: data.autoRenewal ? "Yes" : "" },
          { label: "Notice Period", value: data.noticePeriod },
          { label: "Governing Law", value: data.governingLaw },
        ]}
      />

      {/* File upload zone */}
      <div className="rounded-[var(--radius)] border border-border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Contract File
        </p>
        {file ? (
          <div className="flex items-center gap-3 rounded-[var(--radius)] border border-border bg-muted/40 px-3 py-2.5">
            <div className="flex size-8 items-center justify-center rounded bg-primary/10">
              <Check className="size-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {(file.size / (1024 * 1024)).toFixed(2)} MB
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs shrink-0"
              onClick={() => {
                const input = document.createElement("input")
                input.type = "file"
                input.accept = ".pdf,.docx"
                input.onchange = (e) => {
                  const f = (e.target as HTMLInputElement).files?.[0]
                  if (f) onFileSelect(f)
                }
                input.click()
              }}
            >
              Replace
            </Button>
          </div>
        ) : (
          <FileUploadZone onFileSelect={onFileSelect} className="py-8" />
        )}
        <p className="mt-2 text-xs text-muted-foreground">PDF or DOCX, max 50 MB. Optional — can be uploaded later.</p>
      </div>
    </div>
  )
}

// ---- Main Page ----
export default function NewContractPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [formData, setFormData] = useState<FormData>(defaultFormData)

  // Suppress unused folder fetch warning — folders fetched elsewhere when needed
  useEffect(() => {
    fetch("/api/folders").catch(() => {})
  }, [])

  function updateField(key: keyof FormData, value: string) {
    setFormData((prev) => ({ ...prev, [key]: value }))
  }

  function toggleRenewal() {
    setFormData((prev) => ({ ...prev, autoRenewal: !prev.autoRenewal }))
  }

  function handleFileSelect(f: File) {
    setFile(f)
    if (!formData.title) {
      setFormData((prev) => ({ ...prev, title: titleCaseFromFilename(f.name) }))
    }
  }

  function handleNext() {
    if (currentStep === 0 && !formData.title.trim()) {
      toast.error("Contract title is required")
      return
    }
    if (currentStep === 0 && formData.startDate && formData.endDate && formData.endDate < formData.startDate) {
      toast.error("End date must be after start date")
      return
    }
    setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  function handleBack() {
    setCurrentStep((s) => Math.max(s - 1, 0))
  }

  async function handleSubmit() {
    if (!formData.title.trim()) { toast.error("Title is required"); return }

    setLoading(true)
    try {
      const body: Record<string, unknown> = {
        title: formData.title.trim(),
        contractType: formData.contractType || undefined,
        counterpartyName: formData.counterpartyName || undefined,
        counterpartyContact: formData.counterpartyEmail || undefined,
        value: formData.value ? Number(formData.value) : undefined,
        currency: formData.currency,
        startDate: formData.startDate || undefined,
        endDate: formData.endDate || undefined,
        governingLaw: formData.governingLaw || undefined,
        autoRenewal: formData.autoRenewal,
        noticePeriodDays: formData.noticePeriod ? parseInt(formData.noticePeriod) : undefined,
        notes: formData.description || undefined,
      }

      const res = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? "Failed to create contract")
      }

      const contract = await res.json()

      if (file) {
        const fd = new FormData()
        fd.append("file", file)
        await fetch(`/api/contracts/${contract.id}/upload`, {
          method: "POST",
          body: fd,
        })
      }

      toast.success("Contract created")
      router.push(`/contracts/${contract.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create contract")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-foreground">New Contract</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Fill in the details to create a new contract</p>
      </div>

      <StepIndicator currentStep={currentStep} />

      {/* Step content */}
      <div className="rounded-[var(--radius)] border border-border bg-card p-6">
        {currentStep === 0 && (
          <Step1 data={formData} onChange={updateField} />
        )}
        {currentStep === 1 && (
          <Step2 data={formData} onChange={updateField} />
        )}
        {currentStep === 2 && (
          <Step3 data={formData} onChange={updateField} onToggleRenewal={toggleRenewal} />
        )}
        {currentStep === 3 && (
          <Step4 data={formData} file={file} onFileSelect={handleFileSelect} />
        )}
      </div>

      {/* Navigation */}
      <div className="mt-6 flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={currentStep === 0 ? () => router.back() : handleBack}
        >
          {currentStep === 0 ? "Cancel" : "Previous"}
        </Button>

        <div className="flex items-center gap-3">
          {currentStep < STEPS.length - 1 ? (
            <Button type="button" onClick={handleNext}>
              Next
            </Button>
          ) : (
            <Button type="button" onClick={handleSubmit} disabled={loading}>
              {loading ? "Creating..." : "Create Contract"}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

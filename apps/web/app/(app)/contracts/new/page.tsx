"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FileUploadZone } from "@/components/file-upload-zone"
import { Folder } from "@/lib/types"

const CONTRACT_TYPES = ["NDA", "MSA", "SOW", "EMPLOYMENT", "VENDOR", "CUSTOMER", "OTHER"] as const
const CURRENCIES = ["USD", "EUR", "GBP", "OTHER"] as const

function titleCaseFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "") // strip extension
    .replace(/[-_]+/g, " ") // hyphens/underscores → spaces
    .replace(/\b\w/g, (c) => c.toUpperCase()) // title case
    .trim()
}

export default function NewContractPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [showDetails, setShowDetails] = useState(false)
  const [, setFolders] = useState<Folder[]>([])

  const [details, setDetails] = useState({
    contractType: "",
    counterpartyName: "",
    counterpartyContact: "",
    value: "",
    currency: "USD",
    startDate: "",
    endDate: "",
    notes: "",
  })

  useEffect(() => {
    fetch("/api/folders").then(r => r.json()).then(setFolders).catch(() => {})
  }, [])

  function handleFileSelect(f: File) {
    setFile(f)
    if (!title) {
      setTitle(titleCaseFromFilename(f.name))
    }
  }

  function updateDetail(key: string, value: string) {
    setDetails((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { toast.error("Title is required"); return }
    if (details.startDate && details.endDate && details.endDate < details.startDate) {
      toast.error("End date must be after start date")
      return
    }

    setLoading(true)
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        contractType: details.contractType || undefined,
        counterpartyName: details.counterpartyName || undefined,
        counterpartyContact: details.counterpartyContact || undefined,
        value: details.value ? Number(details.value) : undefined,
        currency: details.currency,
        startDate: details.startDate || undefined,
        endDate: details.endDate || undefined,
        notes: details.notes || undefined,
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
      <div className="mb-6">
        <h1 className="text-xl font-semibold">New Contract</h1>
        <p className="text-sm text-muted-foreground">Upload a file to get started — details can be added later</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Upload zone */}
        <FileUploadZone
          onFileSelect={handleFileSelect}
          className="py-14"
        />

        {/* Title */}
        <div className="space-y-1.5">
          <Label htmlFor="title">
            Title <span className="text-destructive">*</span>
          </Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Service Agreement Q1 2025"
            required
          />
        </div>

        {/* Details toggle */}
        <div>
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {showDetails ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showDetails ? "Hide details" : "Add details (optional)"}
          </button>

          {showDetails && (
            <div className="mt-4 space-y-4 rounded-lg border border-border bg-muted/20 p-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Contract type */}
                <div className="space-y-1.5">
                  <Label htmlFor="contractType">Contract Type</Label>
                  <Select value={details.contractType} onValueChange={(v) => updateDetail("contractType", v ?? "")}>
                    <SelectTrigger id="contractType" className="w-full">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTRACT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Currency */}
                <div className="space-y-1.5">
                  <Label htmlFor="currency">Currency</Label>
                  <Select value={details.currency} onValueChange={(v) => updateDetail("currency", v ?? "")}>
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
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="counterpartyName">Counterparty Name</Label>
                  <Input
                    id="counterpartyName"
                    value={details.counterpartyName}
                    onChange={(e) => updateDetail("counterpartyName", e.target.value)}
                    placeholder="Acme Corp"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="counterpartyContact">Counterparty Email</Label>
                  <Input
                    id="counterpartyContact"
                    type="email"
                    value={details.counterpartyContact}
                    onChange={(e) => updateDetail("counterpartyContact", e.target.value)}
                    placeholder="legal@acme.com"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="value">Contract Value</Label>
                <Input
                  id="value"
                  type="number"
                  min="0"
                  step="0.01"
                  value={details.value}
                  onChange={(e) => updateDetail("value", e.target.value)}
                  placeholder="50000"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="startDate">Start Date</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={details.startDate}
                    onChange={(e) => updateDetail("startDate", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="endDate">End Date</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={details.endDate}
                    onChange={(e) => updateDetail("endDate", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={details.notes}
                  onChange={(e) => updateDetail("notes", e.target.value)}
                  placeholder="Additional notes..."
                  rows={3}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={loading}>
            {loading ? "Creating..." : "Upload & Create"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}

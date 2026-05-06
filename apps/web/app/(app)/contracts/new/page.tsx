"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FileUploadZone } from "@/components/file-upload-zone"
import { Folder, Tag } from "@/lib/types"

const CONTRACT_TYPES = ["NDA", "MSA", "SOW", "EMPLOYMENT", "VENDOR", "CUSTOMER", "OTHER"] as const
const CURRENCIES = ["USD", "EUR", "GBP", "OTHER"] as const

export default function NewContractPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  const [form, setForm] = useState({
    title: "",
    contractType: "",
    counterpartyName: "",
    counterpartyContact: "",
    value: "",
    currency: "USD",
    startDate: "",
    endDate: "",
    renewalDate: "",
    noticePeriodDays: "",
    autoRenewal: false,
    folderId: "",
    governingLaw: "",
    notes: "",
  })

  useEffect(() => {
    fetch("/api/folders").then(r => r.json()).then(setFolders).catch(() => {})
    fetch("/api/tags").then(r => r.json()).then(setTags).catch(() => {})
  }, [])

  function update(key: string, value: string | boolean | null) {
    setForm((prev) => ({ ...prev, [key]: value ?? "" }))
  }

  function toggleTag(id: string) {
    setSelectedTags((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) { toast.error("Title is required"); return }
    if (!form.contractType) { toast.error("Contract type is required"); return }

    setLoading(true)
    try {
      const body: Record<string, unknown> = {
        title: form.title,
        contractType: form.contractType,
        counterpartyName: form.counterpartyName || undefined,
        counterpartyContact: form.counterpartyContact || undefined,
        value: form.value ? Number(form.value) : undefined,
        currency: form.currency,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
        renewalDate: form.renewalDate || undefined,
        noticePeriodDays: form.noticePeriodDays ? Number(form.noticePeriodDays) : undefined,
        autoRenewal: form.autoRenewal,
        folderId: form.folderId || undefined,
        governingLaw: form.governingLaw || undefined,
        notes: form.notes || undefined,
        tagIds: selectedTags.length > 0 ? selectedTags : undefined,
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
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">New Contract</h1>
        <p className="text-sm text-muted-foreground">Fill in the details below</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Basic Info */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Basic Info</h2>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">Title <span className="text-destructive">*</span></Label>
              <Input id="title" value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="Service Agreement Q1 2025" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contractType">Contract Type <span className="text-destructive">*</span></Label>
              <Select value={form.contractType} onValueChange={(v) => update("contractType", v)} required>
                <SelectTrigger id="contractType">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="counterpartyName">Counterparty Name</Label>
                <Input id="counterpartyName" value={form.counterpartyName} onChange={(e) => update("counterpartyName", e.target.value)} placeholder="Acme Corp" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="counterpartyContact">Counterparty Email</Label>
                <Input id="counterpartyContact" type="email" value={form.counterpartyContact} onChange={(e) => update("counterpartyContact", e.target.value)} placeholder="legal@acme.com" />
              </div>
            </div>
          </div>
        </section>

        {/* Financials */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Financials</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="value">Value</Label>
              <Input id="value" type="number" min="0" step="0.01" value={form.value} onChange={(e) => update("value", e.target.value)} placeholder="50000" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="currency">Currency</Label>
              <Select value={form.currency} onValueChange={(v) => update("currency", v)}>
                <SelectTrigger id="currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        {/* Dates */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Dates</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="startDate">Start Date</Label>
              <Input id="startDate" type="date" value={form.startDate} onChange={(e) => update("startDate", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endDate">End Date</Label>
              <Input id="endDate" type="date" value={form.endDate} onChange={(e) => update("endDate", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="renewalDate">Renewal Date</Label>
              <Input id="renewalDate" type="date" value={form.renewalDate} onChange={(e) => update("renewalDate", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="noticePeriodDays">Notice Period (days)</Label>
              <Input id="noticePeriodDays" type="number" min="0" value={form.noticePeriodDays} onChange={(e) => update("noticePeriodDays", e.target.value)} placeholder="30" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="autoRenewal"
              type="checkbox"
              checked={form.autoRenewal}
              onChange={(e) => update("autoRenewal", e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            <Label htmlFor="autoRenewal" className="cursor-pointer">Auto-renewal</Label>
          </div>
        </section>

        {/* Organization */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Organization</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="folderId">Folder</Label>
              <Select value={form.folderId || "none"} onValueChange={(v) => update("folderId", v === "none" ? "" : v)}>
                <SelectTrigger id="folderId">
                  <SelectValue placeholder="No folder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No folder</SelectItem>
                  {folders.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="governingLaw">Governing Law</Label>
              <Input id="governingLaw" value={form.governingLaw} onChange={(e) => update("governingLaw", e.target.value)} placeholder="New York" />
            </div>
          </div>
          {tags.length > 0 && (
            <div className="space-y-2">
              <Label>Tags</Label>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      selectedTags.includes(tag.id)
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                    style={tag.color && selectedTags.includes(tag.id) ? { borderColor: tag.color, backgroundColor: `${tag.color}20`, color: tag.color } : undefined}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Additional notes..." rows={3} />
          </div>
        </section>

        {/* File Upload */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">File</h2>
          <FileUploadZone onFileSelect={setFile} />
        </section>

        <div className="flex gap-3">
          <Button type="submit" disabled={loading}>
            {loading ? "Creating..." : "Create Contract"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}

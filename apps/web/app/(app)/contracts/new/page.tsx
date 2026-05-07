"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { FileUploadZone } from "@/components/file-upload-zone"
import { Folder, Tag } from "@/lib/types"
import { cn } from "@/lib/utils"

const CONTRACT_TYPES = ["NDA", "MSA", "SOW", "EMPLOYMENT", "VENDOR", "CUSTOMER", "OTHER"] as const
const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "OTHER"] as const

const STEPS = [
  { number: 1, label: "Upload" },
  { number: 2, label: "Details" },
  { number: 3, label: "Organize" },
]

function titleCaseFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

export default function NewContractPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)

  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [contractType, setContractType] = useState("")
  const [counterpartyName, setCounterpartyName] = useState("")
  const [counterpartyContact, setCounterpartyContact] = useState("")

  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [renewalDate, setRenewalDate] = useState("")
  const [value, setValue] = useState("")
  const [currency, setCurrency] = useState("USD")
  const [autoRenewal, setAutoRenewal] = useState(false)
  const [notes, setNotes] = useState("")

  const [folderId, setFolderId] = useState("")
  const [folders, setFolders] = useState<Folder[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set())
  const [newTagName, setNewTagName] = useState("")

  useEffect(() => {
    fetch("/api/folders").then(r => r.json()).then(d => setFolders(Array.isArray(d) ? d : [])).catch(() => {})
    fetch("/api/tags").then(r => r.json()).then(d => setTags(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  function handleFileSelect(f: File) {
    setFile(f)
    if (!title) setTitle(titleCaseFromFilename(f.name))
  }

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

  async function handleSubmit() {
    setLoading(true)
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        contractType: contractType || undefined,
        counterpartyName: counterpartyName || undefined,
        counterpartyContact: counterpartyContact || undefined,
        value: value ? Number(value) : undefined,
        currency,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        renewalDate: renewalDate || undefined,
        autoRenewal,
        notes: notes || undefined,
        folderId: folderId || undefined,
        tagIds: Array.from(selectedTagIds.values()),
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
    <div className="flex h-full flex-col items-center overflow-auto p-6">
      {/* Back button */}
      <div className="w-full max-w-lg">
        <button
          onClick={() => (step > 1 ? setStep(step - 1) : router.back())}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="size-4" />
          {step > 1 ? "Back" : "Cancel"}
        </button>
      </div>

      {/* Step indicator with connecting line */}
      <div className="mt-6 flex items-center">
        {STEPS.map((s, i) => (
          <div key={s.number} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  "flex size-8 items-center justify-center rounded-full text-sm font-medium",
                  step === s.number
                    ? "bg-foreground text-background"
                    : step > s.number
                      ? "bg-foreground text-background opacity-40"
                      : "border border-border bg-background text-muted-foreground",
                )}
              >
                {s.number}
              </div>
              <span
                className={cn(
                  "text-xs font-medium",
                  step === s.number ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  "mx-3 mb-5 h-px w-20",
                  step > s.number ? "bg-foreground/40" : "bg-border",
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="mt-6 w-full max-w-lg">
        {step === 1 && (
          <div className="rounded-lg border border-border bg-card p-6 space-y-5">
            <div>
              <p className="text-sm font-medium text-foreground">Upload Contract</p>
              <p className="mt-0.5 text-sm text-muted-foreground">Upload your document and enter basic information.</p>
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

            <div className="space-y-1.5">
              <Label htmlFor="contractType">Contract Type</Label>
              <Select value={contractType} onValueChange={(v) => setContractType(v ?? "")}>
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

            <div className="space-y-1.5">
              <Label htmlFor="counterpartyName">Counterparty</Label>
              <Input
                id="counterpartyName"
                value={counterpartyName}
                onChange={(e) => setCounterpartyName(e.target.value)}
                placeholder="e.g., Acme Corporation"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!title.trim()}
                onClick={() => setStep(2)}
              >
                Continue
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="rounded-lg border border-border bg-card p-6 space-y-5">
            <div>
              <p className="text-sm font-medium text-foreground">Contract Details</p>
              <p className="mt-0.5 text-sm text-muted-foreground">Add dates, value, and any additional notes.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="startDate">Start date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="endDate">End date</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="renewalDate">Renewal date</Label>
              <Input
                id="renewalDate"
                type="date"
                value={renewalDate}
                onChange={(e) => setRenewalDate(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Auto-renewal</p>
                <p className="text-xs text-muted-foreground">Contract renews automatically at expiry</p>
              </div>
              <Switch checked={autoRenewal} onCheckedChange={setAutoRenewal} />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="value">Contract value</Label>
                <Input
                  id="value"
                  type="number"
                  min="0"
                  step="0.01"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="50000"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="currency">Currency</Label>
                <Select value={currency} onValueChange={(v) => setCurrency(v ?? "USD")}>
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

            <div className="space-y-1.5">
              <Label htmlFor="counterpartyContact">Counterparty email</Label>
              <Input
                id="counterpartyContact"
                type="email"
                value={counterpartyContact}
                onChange={(e) => setCounterpartyContact(e.target.value)}
                placeholder="legal@acme.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional context, special terms..."
                rows={3}
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setStep(1)}>
                <ChevronLeft className="size-4" />
                Back
              </Button>
              <Button type="button" size="sm" onClick={() => setStep(3)}>
                Continue
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="rounded-lg border border-border bg-card p-6 space-y-5">
            <div>
              <p className="text-sm font-medium text-foreground">Organize</p>
              <p className="mt-0.5 text-sm text-muted-foreground">Add this contract to a folder and tag it for easy discovery.</p>
            </div>

            {/* Folder */}
            <div className="space-y-1.5">
              <Label htmlFor="folder">Folder</Label>
              <Select value={folderId} onValueChange={(v) => setFolderId(v ?? "")}>
                <SelectTrigger id="folder" className="w-full">
                  <SelectValue placeholder="No folder" />
                </SelectTrigger>
                <SelectContent>
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
                        "inline-flex items-center rounded px-2 py-0.5 text-xs font-medium transition-colors",
                        selectedTagIds.has(tag.id)
                          ? "bg-foreground text-background"
                          : "bg-muted text-muted-foreground hover:text-foreground",
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
              <Button type="button" size="sm" disabled={loading} onClick={handleSubmit}>
                {loading ? "Creating..." : "Create contract"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

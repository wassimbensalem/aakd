"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { format } from "date-fns"
import {
  Edit, Archive, Upload, Download
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ContractStatusBadge } from "@/components/contract-status-badge"
import { ContractTypeBadge } from "@/components/contract-type-badge"
import { ActivityTimeline } from "@/components/activity-timeline"
import { FileUploadZone } from "@/components/file-upload-zone"
import { RelativeTime } from "@/components/relative-time"
import { Contract, ContractFile, Activity, ContractStatus } from "@/lib/types"

const STATUS_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  DRAFT: ["INTERNAL_REVIEW", "ARCHIVED"],
  INTERNAL_REVIEW: ["PENDING_APPROVAL", "DRAFT", "ARCHIVED"],
  PENDING_APPROVAL: ["AWAITING_SIGNATURE", "INTERNAL_REVIEW", "ARCHIVED"],
  AWAITING_SIGNATURE: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["EXPIRED", "TERMINATED", "ARCHIVED"],
  EXPIRED: ["ARCHIVED"],
  TERMINATED: ["ARCHIVED"],
  ARCHIVED: [],
}

const CONTRACT_TYPES = ["NDA", "MSA", "SOW", "EMPLOYMENT", "VENDOR", "CUSTOMER", "OTHER"] as const
const CURRENCIES = ["USD", "EUR", "GBP", "OTHER"] as const

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function MetaField({ label, value }: { label: string; value?: string | number | boolean | null }) {
  if (value == null || value === "") return null
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-medium">{String(value)}</p>
    </div>
  )
}

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()

  const [contract, setContract] = useState<Contract | null>(null)
  const [files, setFiles] = useState<ContractFile[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(searchParams.get("edit") === "true")
  const [uploadOpen, setUploadOpen] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Contract>>({})
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const fetchContract = useCallback(async () => {
    try {
      const res = await fetch(`/api/contracts/${id}`)
      if (!res.ok) { toast.error("Contract not found"); router.push("/contracts"); return }
      const data = await res.json()
      setContract(data.contract ?? data)
      setFiles(data.files ?? [])
      setActivities(data.activities ?? [])
      setEditForm(data.contract ?? data)
    } catch {
      toast.error("Failed to load contract")
    } finally {
      setLoading(false)
    }
  }, [id, router])

  useEffect(() => { fetchContract() }, [fetchContract])

  async function changeStatus(newStatus: ContractStatus) {
    try {
      const res = await fetch(`/api/contracts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success("Status updated")
      fetchContract()
    } catch {
      toast.error("Failed to update status")
    }
  }

  async function saveEdit() {
    setSaving(true)
    try {
      const res = await fetch(`/api/contracts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success("Contract updated")
      setEditOpen(false)
      fetchContract()
    } catch {
      toast.error("Failed to update contract")
    } finally {
      setSaving(false)
    }
  }

  async function handleUpload() {
    if (!uploadFile) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", uploadFile)
      const res = await fetch(`/api/contracts/${id}/upload`, { method: "POST", body: fd })
      if (!res.ok) throw new Error("Upload failed")
      toast.success("File uploaded")
      setUploadOpen(false)
      setUploadFile(null)
      fetchContract()
    } catch {
      toast.error("Upload failed")
    } finally {
      setUploading(false)
    }
  }

  async function downloadFile(fileId: string, filename: string) {
    try {
      const res = await fetch(`/api/contracts/${id}/upload?fileId=${fileId}`)
      if (!res.ok) throw new Error("Download failed")
      const { url } = await res.json()
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      a.click()
    } catch {
      toast.error("Download failed")
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-32" />
        <div className="grid grid-cols-3 gap-4 mt-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      </div>
    )
  }

  if (!contract) return null

  const transitions = STATUS_TRANSITIONS[contract.status] ?? []

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-semibold">{contract.title}</h1>
          <ContractStatusBadge status={contract.status} />
          <ContractTypeBadge type={contract.contractType} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {transitions.length > 0 && (
            <Select onValueChange={(v) => changeStatus(v as ContractStatus)}>
              <SelectTrigger className="w-44 h-8 text-sm">
                <SelectValue placeholder="Change status" />
              </SelectTrigger>
              <SelectContent>
                {transitions.map((s) => (
                  <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Edit className="mr-1.5 h-3.5 w-3.5" />
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Upload
          </Button>
          <Button variant="outline" size="sm" onClick={() => changeStatus("ARCHIVED")} className="text-destructive border-destructive/30 hover:bg-destructive/10">
            <Archive className="mr-1.5 h-3.5 w-3.5" />
            Archive
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="files">Files {files.length > 0 && `(${files.length})`}</TabsTrigger>
          <TabsTrigger value="activity">Activity {activities.length > 0 && `(${activities.length})`}</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <MetaField label="Counterparty" value={contract.counterpartyName} />
            <MetaField label="Counterparty Email" value={contract.counterpartyContact} />
            <MetaField label="Value" value={contract.value != null ? `${contract.currency ?? "USD"} ${contract.value.toLocaleString()}` : null} />
            <MetaField label="Governing Law" value={contract.governingLaw} />
            <MetaField label="Start Date" value={contract.startDate ? format(new Date(contract.startDate), "MMM d, yyyy") : null} />
            <MetaField label="End Date" value={contract.endDate ? format(new Date(contract.endDate), "MMM d, yyyy") : null} />
            <MetaField label="Renewal Date" value={contract.renewalDate ? format(new Date(contract.renewalDate), "MMM d, yyyy") : null} />
            <MetaField label="Notice Period" value={contract.noticePeriodDays != null ? `${contract.noticePeriodDays} days` : null} />
            <MetaField label="Auto-renewal" value={contract.autoRenewal ? "Yes" : "No"} />
            <MetaField label="Owner" value={contract.owner?.name} />
            <MetaField label="Folder" value={contract.folder?.name} />
            <MetaField label="Created" value={format(new Date(contract.createdAt), "MMM d, yyyy")} />
          </div>
          {contract.notes && (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground mb-1">Notes</p>
              <p className="text-sm whitespace-pre-wrap rounded-lg bg-muted/40 p-3">{contract.notes}</p>
            </div>
          )}
          {contract.tags && contract.tags.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground mb-2">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {contract.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="px-2 py-0.5 rounded-full text-xs font-medium"
                    style={{ backgroundColor: `${tag.color ?? "#6366f1"}20`, color: tag.color ?? "#6366f1", border: `1px solid ${tag.color ?? "#6366f1"}40` }}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        {/* Files */}
        <TabsContent value="files" className="mt-4">
          {files.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-3">
              <p className="text-sm text-muted-foreground">No files uploaded yet</p>
              <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
                <Upload className="mr-1.5 h-4 w-4" />
                Upload File
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {files.map((f) => (
                <div key={f.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{f.filename}</p>
                      {f.isLatest && <Badge className="text-xs bg-primary/10 text-primary border-0">v{f.version}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(f.sizeBytes)} · Uploaded <RelativeTime date={f.createdAt} />
                      {f.uploadedBy && ` by ${f.uploadedBy.name}`}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => downloadFile(f.id, f.filename)}>
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Activity */}
        <TabsContent value="activity" className="mt-4">
          <ActivityTimeline activities={activities} />
        </TabsContent>
      </Tabs>

      {/* Edit Sheet */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit Contract</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={editForm.title ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Contract Type</Label>
              <Select value={editForm.contractType ?? ""} onValueChange={(v) => setEditForm((p) => ({ ...p, contractType: v as typeof p.contractType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Counterparty Name</Label>
                <Input value={editForm.counterpartyName ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, counterpartyName: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Counterparty Email</Label>
                <Input type="email" value={editForm.counterpartyContact ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, counterpartyContact: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Value</Label>
                <Input type="number" value={editForm.value ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, value: e.target.value ? Number(e.target.value) : null }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={editForm.currency ?? "USD"} onValueChange={(v) => setEditForm((p) => ({ ...p, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Start Date</Label>
                <Input type="date" value={editForm.startDate ? editForm.startDate.slice(0, 10) : ""} onChange={(e) => setEditForm((p) => ({ ...p, startDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>End Date</Label>
                <Input type="date" value={editForm.endDate ? editForm.endDate.slice(0, 10) : ""} onChange={(e) => setEditForm((p) => ({ ...p, endDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Governing Law</Label>
              <Input value={editForm.governingLaw ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, governingLaw: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={4} value={editForm.notes ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))} />
            </div>
            <div className="flex gap-3 pt-2">
              <Button onClick={saveEdit} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload File</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <FileUploadZone onFileSelect={setUploadFile} />
            <div className="flex gap-3">
              <Button onClick={handleUpload} disabled={!uploadFile || uploading}>
                {uploading ? "Uploading..." : "Upload"}
              </Button>
              <Button variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

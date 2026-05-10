"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { useSession } from "@/lib/auth/client"
import Link from "next/link"
import { toast } from "sonner"
import { format } from "date-fns"
import {
  ChevronRight,
  Download,
  Archive,
  Upload,
  FileText,
  Check,
  X,
  Plus,
  Bell,
  CheckCircle,
  XCircle,
  Clock,
  UserCheck,
  Send,
  ExternalLink,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusBadge, TypeBadge } from "@/components/contract-badges"
import { ActivityTimeline } from "@/components/activity-timeline"
import { FileUploadZone } from "@/components/file-upload-zone"
import { RelativeTime } from "@/components/relative-time"
import { ObligationList } from "@/components/obligations/obligation-list"
import type { Obligation } from "@/components/obligations/types"
import { EditorTab } from "@/components/editor/editor-tab"
import { ContractCrmSection } from "@/components/crm/contract-crm-section"
import { Contract, ContractFile, Activity, ContractStatus, ContractAlert, Tag, Approval, OrgMember, SigningStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

interface AIExtraction {
  id: string
  field: string
  rawValue: string
  confidence: number
  sourceText: string
  sourcePage: number | null
  status: "pending" | "accepted" | "rejected"
}

interface AskCitation {
  chunkIndex: number
  text: string
  similarity: number | null
}

const STATUS_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  DRAFT:               ["INTERNAL_REVIEW", "ARCHIVED"],
  INTERNAL_REVIEW:     ["PENDING_APPROVAL", "DRAFT", "ARCHIVED"],
  PENDING_APPROVAL:    ["AWAITING_SIGNATURE", "INTERNAL_REVIEW", "ARCHIVED"],
  AWAITING_SIGNATURE:  ["ACTIVE", "ARCHIVED"],
  ACTIVE:              ["EXPIRED", "TERMINATED", "ARCHIVED"],
  EXPIRED:             ["ARCHIVED"],
  TERMINATED:          ["ARCHIVED"],
  ARCHIVED:            [],
}

const CONTRACT_TYPES = ["NDA", "MSA", "SOW", "EMPLOYMENT", "VENDOR", "CUSTOMER", "OTHER"] as const
const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "OTHER"] as const

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function MetaField({ label, value }: { label: string; value?: string | number | boolean | null }) {
  if (value == null || value === "") return null
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-0.5 text-sm text-zinc-900">{String(value)}</p>
    </div>
  )
}

const SIGNING_STATUS_LABELS: Record<SigningStatus, string> = {
  sent: "Sent",
  completed: "Completed",
  declined: "Declined",
  expired: "Expired",
  failed: "Failed",
}

function SigningStatusBadge({ status }: { status: SigningStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        status === "completed" && "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
        status === "sent" && "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
        status === "declined" && "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
        status === "expired" && "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
        status === "failed" && "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200",
      )}
    >
      {SIGNING_STATUS_LABELS[status]}
    </span>
  )
}

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()

  const { data: session } = useSession()

  const [contract, setContract] = useState<Contract | null>(null)
  const [files, setFiles] = useState<ContractFile[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [alerts, setAlerts] = useState<ContractAlert[]>([])
  const [extractions, setExtractions] = useState<AIExtraction[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [members, setMembers] = useState<OrgMember[]>([])
  const [approvalOpen, setApprovalOpen] = useState(false)
  const [approvalAssigneeId, setApprovalAssigneeId] = useState("")
  const [approvalMessage, setApprovalMessage] = useState("")
  const [requestingApproval, setRequestingApproval] = useState(false)
  const [deciding, setDeciding] = useState<{ id: string; intent: "approve" | "reject" } | null>(null)
  const [decideComment, setDecideComment] = useState("")
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(searchParams.get("edit") === "true")
  const [uploadOpen, setUploadOpen] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Contract>>({})
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [tagInput, setTagInput] = useState("")
  const [addingTag, setAddingTag] = useState(false)
  const [sendingForSignature, setSendingForSignature] = useState(false)
  const [aiQuestion, setAiQuestion] = useState("")
  const [aiAnswer, setAiAnswer] = useState("")
  const [aiCitations, setAiCitations] = useState<AskCitation[]>([])
  const [askingAI, setAskingAI] = useState(false)

  const fetchContract = useCallback(async (signal?: AbortSignal) => {
    try {
      const [contractRes, alertsRes, extractionsRes, approvalsRes, obligationsRes] = await Promise.all([
        fetch(`/api/contracts/${id}`, { signal }),
        fetch(`/api/alerts?contractId=${id}`, { signal }),
        fetch(`/api/contracts/${id}/extractions`, { signal }),
        fetch(`/api/contracts/${id}/approvals`, { signal }),
        fetch(`/api/contracts/${id}/obligations`, { signal }),
      ])
      if (!contractRes.ok) {
        toast.error("Contract not found")
        router.push("/contracts")
        return
      }
      const data = await contractRes.json()
      setContract(data.contract ?? data)
      setFiles(data.files ?? [])
      setActivities(data.activities ?? [])
      setEditForm(data.contract ?? data)
      if (alertsRes.ok) {
        const alertData = await alertsRes.json()
        setAlerts(alertData.alerts ?? [])
      }
      if (extractionsRes.ok) {
        const extData = await extractionsRes.json()
        setExtractions(extData.extractions ?? [])
      }
      if (approvalsRes.ok) {
        const approvalData = await approvalsRes.json()
        setApprovals(approvalData.approvals ?? [])
      }
      if (obligationsRes.ok) {
        const obligationData = await obligationsRes.json()
        setObligations(obligationData.obligations ?? [])
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return
      toast.error("Failed to load contract")
    } finally {
      setLoading(false)
    }
  }, [id, router])

  useEffect(() => {
    const controller = new AbortController()
    fetchContract(controller.signal)
    fetch("/api/tags", { signal: controller.signal })
      .then(r => r.json())
      .then(d => setAllTags(Array.isArray(d) ? d : []))
      .catch(() => {})
    fetch("/api/org/members", { signal: controller.signal })
      .then(r => r.json())
      .then(d => setMembers(Array.isArray(d) ? d : []))
      .catch(() => {})
    return () => controller.abort()
  }, [fetchContract])

  async function changeStatus(newStatus: ContractStatus) {
    try {
      const res = await fetch(`/api/contracts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        let msg = "Failed to update status"
        try {
          const body = await res.json()
          if (body?.error) msg = typeof body.error === "string" ? body.error : JSON.stringify(body.error)
        } catch {}
        toast.error(msg)
        console.error("[changeStatus] API error", res.status, newStatus)
        return
      }
      toast.success("Status updated")
      fetchContract()
    } catch (err) {
      console.error("[changeStatus] fetch error", err)
      toast.error("Failed to update status")
    }
  }

  async function saveEdit() {
    if (!editForm.title?.trim()) {
      toast.error("Contract title is required")
      return
    }
    if (editForm.startDate && editForm.endDate && editForm.endDate < editForm.startDate) {
      toast.error("End date must be after start date")
      return
    }
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
      toast.error("Failed to update")
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

  async function previewFile(fileId: string) {
    try {
      const res = await fetch(`/api/contracts/${id}/upload?fileId=${fileId}`)
      if (!res.ok) throw new Error("Preview failed")
      const { url } = await res.json()
      window.open(url, "_blank", "noopener,noreferrer")
    } catch {
      toast.error("Failed to open preview")
    }
  }

  async function deleteContract() {
    if (!confirm("Archive this contract? Archived contracts are removed from your active list.")) return
    try {
      const res = await fetch(`/api/contracts/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed")
      toast.success("Contract archived")
      router.push("/contracts")
    } catch {
      toast.error("Failed to archive contract")
    }
  }

  async function handleExtraction(extractionId: string, action: "accept" | "reject") {
    try {
      const res = await fetch(`/api/contracts/${id}/extractions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, extractionId }),
      })
      if (!res.ok) {
        toast.error("Failed to update extraction")
        return
      }
      setExtractions((prev) =>
        prev.map((e) =>
          e.id === extractionId
            ? { ...e, status: action === "accept" ? "accepted" : "rejected" }
            : e,
        ),
      )
    } catch {
      toast.error("Failed to update extraction")
    }
  }

  async function handleAcceptAll() {
    try {
      const res = await fetch(`/api/contracts/${id}/extractions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept_all" }),
      })
      if (!res.ok) { toast.error("Failed to accept all extractions"); return }
      setExtractions((prev) => prev.map((e) => ({ ...e, status: "accepted" as const })))
      toast.success("All extractions accepted")
    } catch {
      toast.error("Failed to accept all")
    }
  }

  async function removeTag(tagId: string) {
    if (!contract) return
    const newTagIds = (contract.tags ?? []).filter(t => t.id !== tagId).map(t => t.id)
    setContract(c => c ? { ...c, tags: (c.tags ?? []).filter(t => t.id !== tagId) } : c)
    try {
      await fetch(`/api/contracts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagIds: newTagIds }),
      })
    } catch {
      fetchContract()
    }
  }

  async function addTag(tagId: string) {
    if (!contract) return
    const existing = contract.tags ?? []
    if (existing.some(t => t.id === tagId)) return
    const tag = allTags.find(t => t.id === tagId)
    if (!tag) return
    const newTagIds = [...existing.map(t => t.id), tagId]
    setContract(c => c ? { ...c, tags: [...(c.tags ?? []), tag] } : c)
    setTagInput("")
    setAddingTag(false)
    try {
      await fetch(`/api/contracts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagIds: newTagIds }),
      })
    } catch {
      fetchContract()
    }
  }

  async function createAndAddTag(name: string) {
    if (!name.trim() || !contract) return
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!res.ok) return
      const newTag = await res.json()
      setAllTags(prev => [...prev, newTag])
      const existing = contract.tags ?? []
      const newTagIds = [...existing.map(t => t.id), newTag.id]
      setContract(c => c ? { ...c, tags: [...(c.tags ?? []), newTag] } : c)
      setTagInput("")
      setAddingTag(false)
      await fetch(`/api/contracts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagIds: newTagIds }),
      })
    } catch {
      fetchContract()
    }
  }

  async function requestApproval() {
    if (!approvalAssigneeId) return
    setRequestingApproval(true)
    try {
      const res = await fetch(`/api/contracts/${id}/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedToId: approvalAssigneeId, message: approvalMessage || undefined }),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success("Approval requested")
      setApprovalOpen(false)
      setApprovalAssigneeId("")
      setApprovalMessage("")
      fetchContract()
    } catch {
      toast.error("Failed to request approval")
    } finally {
      setRequestingApproval(false)
    }
  }

  async function decideApproval(approvalId: string, decision: "approved" | "rejected", comment?: string) {
    try {
      const res = await fetch(`/api/contracts/${id}/approvals/${approvalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment }),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success(decision === "approved" ? "Approved" : "Rejected")
      setDeciding(null)
      setDecideComment("")
      fetchContract()
    } catch {
      toast.error("Failed to submit decision")
    }
  }

  async function sendForSignature() {
    setSendingForSignature(true)
    try {
      const res = await fetch(`/api/contracts/${id}/sign`, { method: "POST" })
      if (res.ok) {
        const { signingUrl } = await res.json()
        toast.success("Sent for signature")
        if (signingUrl) window.open(signingUrl, "_blank")
        fetchContract()
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? "Failed to send for signature")
      }
    } catch {
      toast.error("Failed to send for signature")
    } finally {
      setSendingForSignature(false)
    }
  }

  async function askAI() {
    if (!aiQuestion.trim()) return
    setAskingAI(true)
    setAiAnswer("")
    setAiCitations([])
    try {
      const res = await fetch(`/api/contracts/${id}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: aiQuestion }),
      })
      if (res.ok) {
        const { answer, citations } = await res.json()
        setAiAnswer(answer)
        setAiCitations(Array.isArray(citations) ? citations : [])
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? "Failed to get answer")
      }
    } catch {
      toast.error("Failed to get answer")
    } finally {
      setAskingAI(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-4 w-32" />
        <div className="mt-6 grid grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
    )
  }

  if (!contract) return null

  const transitions = STATUS_TRANSITIONS[contract.status] ?? []
  const latestFile = files.find((f) => f.isLatest) ?? files[0]
  const pendingExtractions = extractions.filter((e) => e.status === "pending")
  const pendingApprovals = approvals.filter((a) => a.status === "pending")
  const activeObligations = obligations.filter(
    (o) => o.status === "PENDING" || o.status === "IN_PROGRESS",
  )
  const canSendForSignature =
    contract.status === "AWAITING_SIGNATURE" &&
    (!contract.signingStatus || ["declined", "expired", "failed"].includes(contract.signingStatus))

  // Determine if current user can request approvals (admin or legal in this org)
  const currentMember = members.find((m) => m.userId === session?.user?.id)
  const canRequestApproval = currentMember?.role === "admin" || currentMember?.role === "legal"
  const canManage = currentMember?.role === "admin" || currentMember?.role === "legal"

  return (
    <div className="p-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm text-zinc-500">
        <Link href="/contracts" className="hover:text-zinc-900">
          Contracts
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="text-zinc-900">{contract.title}</span>
      </nav>

      {/* Header */}
      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-semibold text-zinc-900">{contract.title}</h1>
          <StatusBadge status={contract.status} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {transitions.length > 0 && (
            <Select onValueChange={(v) => changeStatus(v as ContractStatus)}>
              <SelectTrigger className="h-8 w-44 text-sm">
                <SelectValue placeholder="Change status" />
              </SelectTrigger>
              <SelectContent>
                {transitions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {latestFile && (
            <Button variant="outline" size="sm" className="border-zinc-300 text-zinc-700 hover:bg-zinc-50" onClick={() => downloadFile(latestFile.id, latestFile.filename)}>
              <Download className="size-4" />
              Download
            </Button>
          )}
          <Button variant="outline" size="sm" className="border-zinc-300 text-zinc-700 hover:bg-zinc-50" onClick={() => setUploadOpen(true)}>
            <Upload className="size-4" />
            Upload
          </Button>
          {canSendForSignature && (
            <Button
              size="sm"
              disabled={sendingForSignature}
              onClick={sendForSignature}
            >
              <Send className="size-4" />
              {sendingForSignature ? "Sending..." : "Send for Signature"}
            </Button>
          )}
          <Button variant="outline" size="sm" className="border-zinc-300 text-zinc-700 hover:bg-zinc-50" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
        </div>
      </div>

      {/* Two Column Layout */}
      <div className="mt-6 grid grid-cols-12 gap-6">
        {/* Left Column — Tabs */}
        <div className="col-span-12 lg:col-span-8">
          <Tabs defaultValue={searchParams.get("tab") === "editor" ? "editor" : "overview"}>
            <TabsList className="h-auto rounded-none border-b border-zinc-200 bg-transparent p-0">
              <TabsTrigger
                value="overview"
                className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-zinc-500 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 data-[state=active]:shadow-none hover:text-zinc-700"
              >
                Overview
              </TabsTrigger>
              <TabsTrigger
                value="documents"
                className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-zinc-500 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 data-[state=active]:shadow-none hover:text-zinc-700"
              >
                Documents{files.length > 0 && ` (${files.length})`}
              </TabsTrigger>
              <TabsTrigger
                value="editor"
                className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-zinc-500 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 data-[state=active]:shadow-none hover:text-zinc-700"
              >
                Editor
              </TabsTrigger>
              <TabsTrigger
                value="ai-extractions"
                className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-zinc-500 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 data-[state=active]:shadow-none hover:text-zinc-700"
              >
                AI Extractions
                {pendingExtractions.length > 0 && (
                  <span className="ml-1.5 rounded bg-indigo-600 px-1.5 py-0.5 text-xs font-medium text-white">
                    {pendingExtractions.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="approvals"
                className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-zinc-500 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 data-[state=active]:shadow-none hover:text-zinc-700"
              >
                Approvals
                {pendingApprovals.length > 0 && (
                  <span className="ml-1.5 rounded bg-amber-600 px-1.5 py-0.5 text-xs font-medium text-white">
                    {pendingApprovals.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="obligations"
                className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-zinc-500 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 data-[state=active]:shadow-none hover:text-zinc-700"
              >
                Obligations
                {activeObligations.length > 0 && (
                  <span className="ml-1.5 rounded bg-indigo-600 px-1.5 py-0.5 text-xs font-medium text-white">
                    {activeObligations.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="activity"
                className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-zinc-500 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-600 data-[state=active]:shadow-none hover:text-zinc-700"
              >
                Activity{activities.length > 0 && ` (${activities.length})`}
              </TabsTrigger>
            </TabsList>

            {/* Overview */}
            <TabsContent value="overview" className="mt-4">
              <div className="rounded-lg border border-zinc-200 bg-white p-5">
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                  <MetaField label="Counterparty" value={contract.counterpartyName} />
                  <MetaField label="Contract Type" value={contract.contractType} />
                  <MetaField
                    label="Start Date"
                    value={contract.startDate ? format(new Date(contract.startDate), "MMM d, yyyy") : null}
                  />
                  <MetaField
                    label="End Date"
                    value={contract.endDate ? format(new Date(contract.endDate), "MMM d, yyyy") : null}
                  />
                  <MetaField
                    label="Value"
                    value={
                      contract.value != null
                        ? `${contract.currency ?? "USD"} ${contract.value.toLocaleString()}`
                        : null
                    }
                  />
                  <MetaField label="Governing Law" value={contract.governingLaw} />
                  <MetaField
                    label="Notice Period"
                    value={contract.noticePeriodDays != null ? `${contract.noticePeriodDays} days` : null}
                  />
                  <MetaField label="Auto-renewal" value={contract.autoRenewal ? "Yes" : "No"} />
                  <MetaField label="Owner" value={contract.owner?.name} />
                  <MetaField label="Folder" value={contract.folder?.name} />
                </div>
                {contract.signingStatus && (
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Signing</p>
                    <SigningStatusBadge status={contract.signingStatus} />
                    {contract.signingUrl && contract.signingStatus === "sent" && (
                      <a
                        href={contract.signingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
                      >
                        Open signing link <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                )}
                {contract.notes && (
                  <div className="mt-4">
                    <p className="text-xs text-zinc-500">Notes</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-900">{contract.notes}</p>
                  </div>
                )}
                {alerts.length > 0 && (
                  <div className="mt-5">
                    <p className="flex items-center gap-1 text-xs font-medium text-zinc-500">
                      <Bell className="size-3" />
                      Renewal Alerts
                    </p>
                    <div className="mt-2 space-y-1.5">
                      {alerts.map((alert) => (
                        <div
                          key={alert.id}
                          className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm"
                        >
                          <span className="text-zinc-900">
                            {alert.alertType.replace(/_/g, " ")}
                          </span>
                          <span className={cn(
                            "text-xs",
                            alert.firedAt ? "text-zinc-500" : "text-amber-600"
                          )}>
                            {alert.firedAt ? "Fired" : format(new Date(alert.triggerDate), "MMM d, yyyy")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Ask AI section — only shown when contract text has been extracted */}
              {contract.hasExtractedText && (
                <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4">
                  <p className="text-sm font-medium text-zinc-900">Ask AI about this contract</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Ask a question and get an answer based on the contract text.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Input
                      placeholder="e.g. What is the notice period?"
                      value={aiQuestion}
                      onChange={(e) => setAiQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") askAI()
                      }}
                      className="flex-1 text-sm"
                      disabled={askingAI}
                    />
                    <Button
                      size="sm"
                      onClick={askAI}
                      disabled={!aiQuestion.trim() || askingAI}
                    >
                      {askingAI ? "Thinking..." : "Ask"}
                    </Button>
                  </div>
                  {aiAnswer && (
                    <div className="mt-3 rounded-md bg-zinc-50 border border-zinc-200 p-3">
                      <p className="whitespace-pre-wrap text-sm text-zinc-900">{aiAnswer}</p>
                      {aiCitations.length > 0 && (
                        <div className="mt-3 border-t border-zinc-200 pt-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Sources</p>
                          <div className="mt-2 space-y-2">
                            {aiCitations.map((citation) => (
                              <details key={citation.chunkIndex} className="rounded border border-zinc-200 bg-white px-3 py-2">
                                <summary className="cursor-pointer text-xs font-medium text-zinc-700">
                                  Excerpt {citation.chunkIndex + 1}
                                  {citation.similarity != null && (
                                    <span className="ml-2 text-zinc-400">
                                      {(citation.similarity * 100).toFixed(0)}% match
                                    </span>
                                  )}
                                </summary>
                                <p className="mt-2 line-clamp-6 whitespace-pre-wrap text-xs text-zinc-600">
                                  {citation.text}
                                </p>
                              </details>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* Documents */}
            <TabsContent value="documents" className="mt-4">
              <div className="rounded-lg border border-zinc-200 bg-white p-5">
                {files.length === 0 ? (
                  <div className="flex flex-col items-center py-8 gap-3">
                    <p className="text-sm text-zinc-500">No files uploaded yet</p>
                    <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
                      <Upload className="size-4" />
                      Upload File
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {files.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3"
                      >
                        <div className="flex size-10 items-center justify-center rounded bg-zinc-100">
                          <FileText className="size-5 text-zinc-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-zinc-900">{f.filename}</p>
                          <p className="text-xs text-zinc-500">
                            {formatBytes(f.sizeBytes)} · <RelativeTime date={f.createdAt} />
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-zinc-300 text-zinc-700 hover:bg-zinc-50"
                          onClick={() => downloadFile(f.id, f.filename)}
                        >
                          <Download className="size-4" />
                          Download
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Editor */}
            <TabsContent value="editor" className="mt-4">
              <EditorTab
                contractId={contract.id}
                contractStatus={contract.status}
                role={currentMember?.role ?? "member"}
              />
            </TabsContent>

            {/* AI Extractions */}
            <TabsContent value="ai-extractions" className="mt-4">
              {extractions.length === 0 ? (
                <div className="rounded-lg border border-zinc-200 bg-white p-5">
                  <p className="text-center text-sm text-zinc-500 py-8">
                    No AI extractions yet. Upload a document to trigger extraction.
                  </p>
                </div>
              ) : (
                <>
                  <div className="mb-4 flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5">
                    <p className="text-sm text-zinc-500">
                      <span className="font-medium text-zinc-900">{extractions.length} fields</span>{" "}
                      extracted by AI
                      {pendingExtractions.length > 0 && ` · ${pendingExtractions.length} pending`}
                    </p>
                    {pendingExtractions.length > 0 && (
                      <Button size="sm" onClick={handleAcceptAll}>
                        Accept All
                      </Button>
                    )}
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-white">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="h-9 text-xs font-medium uppercase tracking-wide text-zinc-500">Field</TableHead>
                          <TableHead className="h-9 text-xs font-medium uppercase tracking-wide text-zinc-500">Value</TableHead>
                          <TableHead className="h-9 text-xs font-medium uppercase tracking-wide text-zinc-500">Confidence</TableHead>
                          <TableHead className="h-9 text-xs font-medium uppercase tracking-wide text-zinc-500">Source</TableHead>
                          <TableHead className="h-9 text-xs font-medium uppercase tracking-wide text-zinc-500">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {extractions.map((e) => {
                          const accepted = e.status === "accepted"
                          const rejected = e.status === "rejected"
                          return (
                            <TableRow
                              key={e.id}
                              className={cn(
                                "hover:bg-zinc-50",
                                (accepted || rejected) && "opacity-60",
                              )}
                            >
                              <TableCell className="py-2.5">
                                <div className="flex items-center gap-1.5">
                                  {accepted && <Check className="size-3.5 text-emerald-600" />}
                                  <span className="text-sm font-medium text-zinc-900">{e.field}</span>
                                </div>
                              </TableCell>
                              <TableCell className="py-2.5 text-sm text-zinc-500">
                                {e.rawValue ?? "—"}
                              </TableCell>
                              <TableCell className="py-2.5">
                                <div className="flex items-center gap-2">
                                  <Progress
                                    value={Math.round(e.confidence * 100)}
                                    className="h-1.5 w-12 [&>div]:bg-indigo-600"
                                  />
                                  <span className="text-xs tabular-nums text-zinc-500">
                                    {Math.round(e.confidence * 100)}%
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="max-w-[200px] py-2.5">
                                {e.sourceText && (
                                  <p className="truncate text-xs italic text-zinc-500">
                                    &quot;{e.sourceText}&quot;
                                  </p>
                                )}
                              </TableCell>
                              <TableCell className="py-2.5">
                                {!accepted && !rejected && (
                                  <div className="flex gap-1">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7"
                                      onClick={() => handleExtraction(e.id, "accept")}
                                    >
                                      Accept
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7"
                                      onClick={() => handleExtraction(e.id, "reject")}
                                    >
                                      Reject
                                    </Button>
                                  </div>
                                )}
                                {accepted && (
                                  <span className="text-xs text-emerald-600">Accepted</span>
                                )}
                                {rejected && (
                                  <span className="text-xs text-zinc-500">Rejected</span>
                                )}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </TabsContent>

            {/* Approvals */}
            <TabsContent value="approvals" className="mt-4">
              <div className="rounded-lg border border-zinc-200 bg-white p-5">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-zinc-900">Approval Requests</h3>
                  {canRequestApproval && (
                    <Button size="sm" onClick={() => setApprovalOpen(true)}>
                      <UserCheck className="size-4" />
                      Request Approval
                    </Button>
                  )}
                </div>

                {approvals.length === 0 ? (
                  <p className="text-center text-sm text-zinc-500 py-8">
                    No approvals requested yet
                  </p>
                ) : (
                  <div className="space-y-3">
                    {approvals.map((approval) => {
                      const isPending = approval.status === "pending"
                      const isMyApproval = approval.assignedToId === session?.user?.id && isPending
                      const isDeciding = deciding?.id === approval.id

                      return (
                        <div
                          key={approval.id}
                          className="rounded-lg border border-zinc-200 p-4 space-y-2"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="flex size-7 items-center justify-center rounded-full bg-zinc-100 shrink-0">
                                <span className="text-xs font-medium text-zinc-500">
                                  {approval.assignedTo.name.charAt(0).toUpperCase()}
                                </span>
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-zinc-900 truncate">
                                  {approval.assignedTo.name}
                                </p>
                                <p className="text-xs text-zinc-500">
                                  Requested by {approval.requestedBy.name} &middot;{" "}
                                  <RelativeTime date={approval.createdAt} />
                                </p>
                              </div>
                            </div>

                            {/* Status badge */}
                            {approval.status === "pending" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 shrink-0">
                                <Clock className="size-3" />
                                Pending
                              </span>
                            )}
                            {approval.status === "approved" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 shrink-0">
                                <CheckCircle className="size-3" />
                                Approved
                              </span>
                            )}
                            {approval.status === "rejected" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/20 dark:text-red-400 shrink-0">
                                <XCircle className="size-3" />
                                Rejected
                              </span>
                            )}
                          </div>

                          {/* Comment */}
                          {approval.comment && (
                            <p className="text-sm text-zinc-500 pl-9">{approval.comment}</p>
                          )}

                          {/* Decided at */}
                          {approval.decidedAt && (
                            <p className="text-xs text-zinc-500 pl-9">
                              Decided <RelativeTime date={approval.decidedAt} />
                            </p>
                          )}

                          {/* Action buttons for assigned user */}
                          {isMyApproval && !isDeciding && (
                            <div className="flex gap-2 pl-9 pt-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400"
                                onClick={() => setDeciding({ id: approval.id, intent: "approve" })}
                              >
                                <Check className="size-3.5" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400"
                                onClick={() => setDeciding({ id: approval.id, intent: "reject" })}
                              >
                                <X className="size-3.5" />
                                Reject
                              </Button>
                            </div>
                          )}

                          {/* Inline decision form */}
                          {isMyApproval && isDeciding && (
                            <div className="pl-9 pt-1 space-y-2">
                              <Textarea
                                rows={2}
                                placeholder="Optional comment..."
                                value={decideComment}
                                onChange={(e) => setDecideComment(e.target.value)}
                                className="text-sm"
                              />
                              <div className="flex gap-2">
                                {deciding?.intent === "approve" && (
                                  <Button
                                    size="sm"
                                    className="h-7 bg-emerald-600 hover:bg-emerald-700 text-white"
                                    onClick={() => decideApproval(approval.id, "approved", decideComment || undefined)}
                                  >
                                    Confirm Approve
                                  </Button>
                                )}
                                {deciding?.intent === "reject" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400"
                                    onClick={() => decideApproval(approval.id, "rejected", decideComment || undefined)}
                                  >
                                    Confirm Reject
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7"
                                  onClick={() => { setDeciding(null); setDecideComment("") }}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Obligations */}
            <TabsContent value="obligations" className="mt-4">
              <ObligationList
                contractId={contract.id}
                obligations={obligations}
                members={members}
                contractArchived={contract.status === "ARCHIVED"}
                role={currentMember?.role}
                onChange={setObligations}
              />
            </TabsContent>

            {/* Activity */}
            <TabsContent value="activity" className="mt-4">
              <div className="rounded-lg border border-zinc-200 bg-white p-5">
                {activities.length === 0 ? (
                  <p className="text-center text-sm text-zinc-500 py-8">No activity yet</p>
                ) : (
                  <ActivityTimeline activities={activities} />
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right Column — Sidebar */}
        <div className="col-span-12 lg:col-span-4">
          <div className="sticky top-6 space-y-4">
            {/* File Card */}
            {latestFile && (
              <div className="rounded-lg border border-zinc-200 bg-white p-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded bg-zinc-100">
                    <FileText className="size-4 text-zinc-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900">{latestFile.filename}</p>
                    <p className="text-xs text-zinc-500">{formatBytes(latestFile.sizeBytes)}</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-zinc-300 text-zinc-700 hover:bg-zinc-50"
                    onClick={() => previewFile(latestFile.id)}
                  >
                    <ExternalLink className="size-4" />
                    Preview
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-zinc-300 text-zinc-700 hover:bg-zinc-50"
                    onClick={() => downloadFile(latestFile.id, latestFile.filename)}
                  >
                    <Download className="size-4" />
                    Download
                  </Button>
                </div>
              </div>
            )}

            {/* Contract Type */}
            {contract.contractType && (
              <div className="rounded-lg border border-zinc-200 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Contract Type</p>
                <div className="mt-1.5">
                  <TypeBadge type={contract.contractType} />
                </div>
              </div>
            )}

            {/* CRM */}
            <ContractCrmSection contractId={id} role={currentMember?.role} />

            {/* Tags */}
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Tags</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {(contract.tags ?? []).map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700"
                  >
                    {tag.name}
                    <button
                      type="button"
                      onClick={() => removeTag(tag.id)}
                      className="text-zinc-400 hover:text-zinc-700"
                    >
                      <X className="size-2.5" />
                    </button>
                  </span>
                ))}
                {addingTag ? (
                  <div className="relative">
                    <Input
                      autoFocus
                      className="h-6 w-28 text-xs px-2"
                      placeholder="Tag name..."
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          const match = allTags.find(t => t.name.toLowerCase() === tagInput.toLowerCase())
                          if (match) addTag(match.id)
                          else if (tagInput.trim()) createAndAddTag(tagInput)
                        }
                        if (e.key === "Escape") { setAddingTag(false); setTagInput("") }
                      }}
                      onBlur={() => { if (!tagInput.trim()) { setAddingTag(false) } }}
                    />
                    {tagInput && (
                      <div className="absolute left-0 top-full z-10 mt-1 w-40 rounded-md border border-zinc-200 bg-white shadow-md">
                        {allTags
                          .filter(t =>
                            t.name.toLowerCase().includes(tagInput.toLowerCase()) &&
                            !(contract.tags ?? []).some(ct => ct.id === t.id)
                          )
                          .slice(0, 5)
                          .map(t => (
                            <button
                              key={t.id}
                              type="button"
                              onMouseDown={(e) => { e.preventDefault(); addTag(t.id) }}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-50"
                            >
                              {t.name}
                            </button>
                          ))
                        }
                        {!allTags.some(t => t.name.toLowerCase() === tagInput.toLowerCase()) && (
                          <button
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); createAndAddTag(tagInput) }}
                            className="w-full px-3 py-1.5 text-left text-xs text-zinc-500 hover:bg-zinc-50"
                          >
                            + Create &quot;{tagInput}&quot;
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingTag(true)}
                    className="inline-flex items-center gap-0.5 rounded border border-dashed border-zinc-300 px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-700 hover:border-zinc-400 transition-colors"
                  >
                    <Plus className="size-2.5" />
                    Add
                  </button>
                )}
              </div>
            </div>

            {/* Danger Zone */}
            {canManage && contract.status !== "ARCHIVED" && (
              <div className="rounded-lg border border-red-100 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-red-500">Danger Zone</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Deleting moves this contract to the archive. It will no longer appear in your active list.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 border-red-200 text-red-600 hover:bg-red-50"
                  onClick={deleteContract}
                >
                  <Archive className="size-4" />
                  Delete Contract
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Sheet */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Edit Contract</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                value={editForm.title ?? ""}
                onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Contract Type</Label>
              <Select
                value={editForm.contractType ?? null}
                onValueChange={(v) =>
                  setEditForm((p) => ({ ...p, contractType: v as typeof p.contractType }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Counterparty Name</Label>
                <Input
                  value={editForm.counterpartyName ?? ""}
                  onChange={(e) => setEditForm((p) => ({ ...p, counterpartyName: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Counterparty Email</Label>
                <Input
                  type="email"
                  value={editForm.counterpartyContact ?? ""}
                  onChange={(e) =>
                    setEditForm((p) => ({ ...p, counterpartyContact: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Value</Label>
                <Input
                  type="number"
                  value={editForm.value ?? ""}
                  onChange={(e) =>
                    setEditForm((p) => ({
                      ...p,
                      value: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select
                  value={editForm.currency ?? "USD"}
                  onValueChange={(v) => setEditForm((p) => ({ ...p, currency: v }))}
                >
                  <SelectTrigger className="w-full">
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
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={editForm.startDate ? editForm.startDate.slice(0, 10) : ""}
                  onChange={(e) => setEditForm((p) => ({ ...p, startDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={editForm.endDate ? editForm.endDate.slice(0, 10) : ""}
                  onChange={(e) => setEditForm((p) => ({ ...p, endDate: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Governing Law</Label>
              <Input
                value={editForm.governingLaw ?? ""}
                onChange={(e) => setEditForm((p) => ({ ...p, governingLaw: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                rows={4}
                value={editForm.notes ?? ""}
                onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button onClick={saveEdit} disabled={saving}>
                {saving ? "Saving..." : "Save Changes"}
              </Button>
              <Button variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
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
          <div className="mt-2 space-y-4">
            <FileUploadZone onFileSelect={setUploadFile} />
            <div className="flex gap-3">
              <Button onClick={handleUpload} disabled={!uploadFile || uploading}>
                {uploading ? "Uploading..." : "Upload"}
              </Button>
              <Button variant="outline" onClick={() => setUploadOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Request Approval Dialog */}
      <Dialog open={approvalOpen} onOpenChange={setApprovalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Approval</DialogTitle>
          </DialogHeader>
          <div className="mt-2 space-y-4">
            <div className="space-y-1.5">
              <Label>Reviewer</Label>
              <Select value={approvalAssigneeId} onValueChange={(v) => setApprovalAssigneeId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select reviewer..." />
                </SelectTrigger>
                <SelectContent>
                  {members
                    .filter((m) => m.userId !== session?.user?.id)
                    .map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>
                        {m.user.name} ({m.user.email})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Message (optional)</Label>
              <Textarea
                rows={3}
                placeholder="Any notes for the reviewer..."
                value={approvalMessage}
                onChange={(e) => setApprovalMessage(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <Button onClick={requestApproval} disabled={!approvalAssigneeId || requestingApproval}>
                {requestingApproval ? "Requesting..." : "Request Approval"}
              </Button>
              <Button variant="outline" onClick={() => setApprovalOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

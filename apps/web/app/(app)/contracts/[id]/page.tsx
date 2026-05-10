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
  Trash2,
  RefreshCw,
  MessageSquare,
  ArrowUpRight,
  Pen,
  Pencil,
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
import { StatusBadge } from "@/components/contract-badges"
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
  const [qaInput, setQaInput] = useState("")
  const [qaThreads, setQaThreads] = useState<Array<{ id: string; question: string; answers: Array<{ name: string; text: string }> }>>([
    {
      id: "demo-1",
      question: "What is the notice period for termination?",
      answers: [{ name: "AI", text: "Based on the contract, the notice period for termination is 90 days written notice to the other party." }],
    },
  ])

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
      const res = await fetch(`/api/contracts/${id}/upload`, { method: "POST", body: fd, credentials: "include" })
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

  async function deleteFile(fileId: string) {
    if (!confirm("Delete this file? This cannot be undone.")) return
    try {
      const res = await fetch(`/api/contracts/${id}/upload?fileId=${fileId}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Delete failed")
      toast.success("File deleted")
      fetchContract()
    } catch {
      toast.error("Failed to delete file")
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
    <div className="flex flex-col h-full">
      {/* ── Header section ── */}
      <div className="px-7 py-3.5 border-b border-border flex-shrink-0">
        {/* Row 1 — Breadcrumb */}
        <nav className="flex items-center gap-1 mb-2">
          <Link
            href="/contracts"
            className="text-primary text-[12px] font-medium hover:underline"
          >
            Contracts
          </Link>
          <ChevronRight className="text-muted-foreground" style={{ width: 11, height: 11 }} />
          <span className="text-muted-foreground text-[12px]">{contract.title}</span>
        </nav>

        {/* Row 2 — Title + actions */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[18px] font-bold tracking-tight text-foreground">{contract.title}</h1>
            <StatusBadge status={contract.status} />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
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
            {canRequestApproval && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setApprovalOpen(true)}
              >
                <ArrowUpRight className="size-3.5" />
                Send for Approval
              </Button>
            )}
            {canSendForSignature && (
              <Button
                size="sm"
                disabled={sendingForSignature}
                onClick={sendForSignature}
              >
                <Pen className="size-3.5" />
                {sendingForSignature ? "Sending..." : "Send for Signing"}
              </Button>
            )}
            {canManage && contract.status !== "ARCHIVED" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={deleteContract}
              >
                <Archive className="size-3.5" />
                Archive
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <Tabs
        defaultValue={searchParams.get("tab") === "editor" ? "editor" : "overview"}
        className="flex flex-col flex-1 min-h-0"
      >
        <TabsList className="h-auto rounded-none border-b-0 bg-transparent p-0 flex gap-0 px-7 border-b border-border flex-shrink-0">
          <TabsTrigger
            value="overview"
            className="rounded-none border-b-2 border-transparent px-3.5 py-2.5 text-[12.5px] font-normal text-muted-foreground -mb-px data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:font-semibold data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:text-foreground transition-colors cursor-pointer"
          >
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="documents"
            className="rounded-none border-b-2 border-transparent px-3.5 py-2.5 text-[12.5px] font-normal text-muted-foreground -mb-px data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:font-semibold data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:text-foreground transition-colors cursor-pointer"
          >
            Files{files.length > 0 && ` (${files.length})`}
          </TabsTrigger>
          <TabsTrigger
            value="ai-extractions"
            className="rounded-none border-b-2 border-transparent px-3.5 py-2.5 text-[12.5px] font-normal text-muted-foreground -mb-px data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:font-semibold data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:text-foreground transition-colors cursor-pointer"
          >
            AI Extractions
            {pendingExtractions.length > 0 && (
              <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">
                {pendingExtractions.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="approvals"
            className="rounded-none border-b-2 border-transparent px-3.5 py-2.5 text-[12.5px] font-normal text-muted-foreground -mb-px data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:font-semibold data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:text-foreground transition-colors cursor-pointer"
          >
            Approvals
            {pendingApprovals.length > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-600 px-1.5 py-0.5 text-xs font-medium text-white">
                {pendingApprovals.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="signing"
            className="rounded-none border-b-2 border-transparent px-3.5 py-2.5 text-[12.5px] font-normal text-muted-foreground -mb-px data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:font-semibold data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:text-foreground transition-colors cursor-pointer"
          >
            Signing
          </TabsTrigger>
          <TabsTrigger
            value="qa"
            className="rounded-none border-b-2 border-transparent px-3.5 py-2.5 text-[12.5px] font-normal text-muted-foreground -mb-px data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:font-semibold data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:text-foreground transition-colors cursor-pointer"
          >
            Q&amp;A
          </TabsTrigger>
          <TabsTrigger
            value="editor"
            className="rounded-none border-b-2 border-transparent px-3.5 py-2.5 text-[12.5px] font-normal text-muted-foreground -mb-px data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:font-semibold data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:text-foreground transition-colors cursor-pointer"
          >
            Editor
            <span className="text-[9px] ml-1 px-1 py-0.5 rounded bg-muted text-muted-foreground font-semibold">M6</span>
          </TabsTrigger>
          <TabsTrigger
            value="obligations"
            className="rounded-none border-b-2 border-transparent px-3.5 py-2.5 text-[12.5px] font-normal text-muted-foreground -mb-px data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:font-semibold data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:text-foreground transition-colors cursor-pointer"
          >
            Obligations
            <span className="text-[9px] ml-1 px-1 py-0.5 rounded bg-muted text-muted-foreground font-semibold">M7</span>
            {activeObligations.length > 0 && (
              <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">
                {activeObligations.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Tab content area ── */}

        {/* Overview — 2-column grid */}
        <TabsContent value="overview" className="flex-1 overflow-auto m-0 border-0">
          <div className="grid grid-cols-[1fr_320px] gap-5 p-7">
            {/* LEFT column */}
            <div className="flex flex-col gap-4">
              {/* Card A — Contract Details */}
              <div className="p-[18px_20px] rounded-[var(--radius)] border border-border bg-card">
                <div className="flex items-center justify-between mb-3.5">
                  <p className="text-[13px] font-semibold">Contract Details</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => setEditOpen(true)}
                    title="Edit contract"
                  >
                    <Pencil style={{ width: 14, height: 14 }} />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3.5">
                  {contract.counterpartyName && (
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Counterparty</p>
                      <p className="text-[13px] font-medium">{contract.counterpartyName}</p>
                    </div>
                  )}
                  {contract.value != null && (
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Contract Value</p>
                      <p className="text-[13px] font-medium">{contract.currency ?? "USD"} {contract.value.toLocaleString()}</p>
                    </div>
                  )}
                  {contract.startDate && (
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Start Date</p>
                      <p className="text-[13px] font-medium">{format(new Date(contract.startDate), "MMM d, yyyy")}</p>
                    </div>
                  )}
                  {contract.endDate && (
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">End Date</p>
                      <p className="text-[13px] font-medium">{format(new Date(contract.endDate), "MMM d, yyyy")}</p>
                    </div>
                  )}
                  {contract.owner?.name && (
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Owner</p>
                      <p className="text-[13px] font-medium">{contract.owner.name}</p>
                    </div>
                  )}
                  {contract.contractType && (
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Type</p>
                      <p className="text-[13px] font-medium">{contract.contractType}</p>
                    </div>
                  )}
                  {contract.governingLaw && (
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Governing Law</p>
                      <p className="text-[13px] font-medium">{contract.governingLaw}</p>
                    </div>
                  )}
                  {contract.noticePeriodDays != null && (
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Notice Period</p>
                      <p className="text-[13px] font-medium">{contract.noticePeriodDays} days</p>
                    </div>
                  )}
                  {contract.folder?.name && (
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Folder</p>
                      <p className="text-[13px] font-medium">{contract.folder.name}</p>
                    </div>
                  )}
                </div>
                {/* Tags row */}
                {((contract.tags ?? []).length > 0 || true) && (
                  <div className="mt-3.5 flex flex-wrap gap-1.5 items-center">
                    {(contract.tags ?? []).map((tag) => (
                      <span
                        key={tag.id}
                        className="inline-flex items-center gap-1 rounded border border-border bg-muted px-2 py-0.5 text-xs text-foreground"
                      >
                        {tag.name}
                        <button
                          type="button"
                          onClick={() => removeTag(tag.id)}
                          className="text-muted-foreground hover:text-foreground"
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
                          <div className="absolute left-0 top-full z-10 mt-1 w-40 rounded-md border border-border bg-card shadow-md">
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
                                  className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted-foreground/[0.08]"
                                >
                                  {t.name}
                                </button>
                              ))
                            }
                            {!allTags.some(t => t.name.toLowerCase() === tagInput.toLowerCase()) && (
                              <button
                                type="button"
                                onMouseDown={(e) => { e.preventDefault(); createAndAddTag(tagInput) }}
                                className="w-full px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted-foreground/[0.08]"
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
                        className="inline-flex items-center gap-0.5 rounded border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                      >
                        <Plus className="size-2.5" />
                        Add tag
                      </button>
                    )}
                  </div>
                )}
                {/* Alerts */}
                {alerts.length > 0 && (
                  <div className="mt-4 pt-3.5 border-t border-border">
                    <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
                      <Bell className="size-3" />
                      Renewal Alerts
                    </p>
                    <div className="space-y-1.5">
                      {alerts.map((alert) => (
                        <div
                          key={alert.id}
                          className="flex items-center justify-between rounded-[var(--radius)] border border-border bg-muted/40 px-3 py-2 text-sm"
                        >
                          <span className="text-foreground text-[12px]">
                            {alert.alertType.replace(/_/g, " ")}
                          </span>
                          <span className={cn(
                            "text-[11px]",
                            alert.firedAt ? "text-muted-foreground" : "text-amber-600"
                          )}>
                            {alert.firedAt ? "Fired" : format(new Date(alert.triggerDate), "MMM d, yyyy")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Notes */}
                {contract.notes && (
                  <div className="mt-3.5 pt-3.5 border-t border-border">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
                    <p className="whitespace-pre-wrap text-[13px] text-foreground">{contract.notes}</p>
                  </div>
                )}
              </div>

              {/* Card B — Linked Deals (CRM) */}
              <ContractCrmSection contractId={id} role={currentMember?.role} />

              {/* Card C — Signing Status */}
              <div className="p-[18px_20px] rounded-[var(--radius)] border border-border bg-card">
                <p className="text-[13px] font-semibold mb-2.5">Signing Status</p>
                {contract.signingStatus ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">DocuSeal</span>
                    <SigningStatusBadge status={contract.signingStatus} />
                    {contract.signingUrl && contract.signingStatus === "sent" && (
                      <a
                        href={contract.signingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        Open signing link <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <p className="text-[13px] text-muted-foreground">No signing configured</p>
                    {canSendForSignature && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={sendingForSignature}
                        onClick={sendForSignature}
                      >
                        <Pen className="size-3.5" />
                        {sendingForSignature ? "Sending..." : "Send for Signing"}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Danger Zone */}
              {canManage && contract.status !== "ARCHIVED" && (
                <div className="p-[18px_20px] rounded-[var(--radius)] border border-red-100 bg-card">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-red-500 mb-1">Danger Zone</p>
                  <p className="text-[12px] text-muted-foreground mb-3">
                    Archiving moves this contract out of your active list.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-200 text-red-600 hover:bg-red-50"
                    onClick={deleteContract}
                  >
                    <Archive className="size-4" />
                    Archive Contract
                  </Button>
                </div>
              )}
            </div>

            {/* RIGHT column — Activity panel */}
            <div className="p-[18px_20px] rounded-[var(--radius)] border border-border bg-card self-start">
              <p className="text-[13px] font-semibold mb-3.5">Activity</p>
              {activities.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">No activity yet</p>
              ) : (
                <div className="space-y-0">
                  {activities.map((activity, idx) => {
                    const isLast = idx === activities.length - 1
                    return (
                      <div key={activity.id} className="flex gap-2.5 py-2 relative">
                        {/* Connector line */}
                        {!isLast && (
                          <div className="absolute left-[11px] top-8 bottom-0 w-px bg-border" />
                        )}
                        {/* Icon circle */}
                        <div className="w-[22px] h-[22px] rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-[10px] font-semibold z-10">
                          {(activity.user?.name ?? "?").charAt(0).toUpperCase()}
                        </div>
                        {/* Text */}
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px]">
                            <span className="font-semibold">{activity.user?.name ?? "System"}</span>
                            {" "}
                            <span className="text-muted-foreground">{activity.action.replace(/_/g, " ").toLowerCase()}</span>
                          </p>
                          <p className="text-[10.5px] text-muted-foreground mt-0.5">
                            <RelativeTime date={activity.createdAt} />
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Files */}
        <TabsContent value="documents" className="flex-1 overflow-auto m-0 border-0">
          <div className="p-7">
            <div className="rounded-[var(--radius)] border border-border bg-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-foreground">Documents</h3>
                <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
                  <Upload className="size-4" />
                  Upload File
                </Button>
              </div>
              {files.length === 0 ? (
                <div className="flex flex-col items-center py-8 gap-3">
                  <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                    <FileText className="size-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">No files uploaded yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {files.map((f) => {
                    const ext = f.filename.split(".").pop()?.toUpperCase() ?? "FILE"
                    const isPdf = ext === "PDF"
                    const isDocx = ext === "DOCX"
                    return (
                      <div
                        key={f.id}
                        className="flex items-center gap-3 rounded-[var(--radius)] border border-border p-3"
                      >
                        <div
                          className={cn(
                            "flex h-9 w-14 shrink-0 items-center justify-center rounded text-xs font-bold",
                            isPdf && "bg-red-100 text-red-700",
                            isDocx && "bg-blue-100 text-blue-700",
                            !isPdf && !isDocx && "bg-emerald-100 text-emerald-700",
                          )}
                        >
                          {ext}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="truncate text-sm font-medium text-foreground">{f.filename}</p>
                            {f.isLatest && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                Current
                              </span>
                            )}
                            {!f.isLatest && f.version && (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                v{f.version}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatBytes(f.sizeBytes)} · Uploaded{" "}
                            <RelativeTime date={f.createdAt} />
                            {f.uploadedBy && (
                              <span> by {f.uploadedBy.name.charAt(0).toUpperCase()}{f.uploadedBy.name.split(" ")[1]?.charAt(0).toUpperCase() ?? ""}</span>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-8 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => previewFile(f.id)}
                            title="Preview"
                          >
                            <ExternalLink className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-8 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => downloadFile(f.id, f.filename)}
                            title="Download"
                          >
                            <Download className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-8 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteFile(f.id)}
                            title="Delete"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* AI Extractions */}
        <TabsContent value="ai-extractions" className="flex-1 overflow-auto m-0 border-0">
          <div className="p-7">
            {extractions.length === 0 ? (
              <div className="rounded-[var(--radius)] border border-border bg-card p-5">
                <p className="text-center text-sm text-muted-foreground py-8">
                  No AI extractions yet. Upload a document to trigger extraction.
                </p>
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{extractions.length} fields</span>{" "}
                    extracted by AI
                    {pendingExtractions.length > 0 && ` · ${pendingExtractions.length} pending review`}
                  </p>
                  <div className="flex items-center gap-2">
                    {pendingExtractions.length > 0 && (
                      <Button size="sm" onClick={handleAcceptAll}>
                        Accept All
                      </Button>
                    )}
                    <Button size="sm" variant="outline">
                      <RefreshCw className="size-3.5" />
                      Re-run Extraction
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {extractions.map((e) => {
                    const accepted = e.status === "accepted"
                    const rejected = e.status === "rejected"
                    const confidencePct = Math.round(e.confidence * 100)
                    return (
                      <div
                        key={e.id}
                        className={cn(
                          "rounded-[var(--radius)] border border-border bg-card p-4",
                          (accepted || rejected) && "opacity-60",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{e.field}</p>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0",
                              confidencePct >= 90
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-amber-100 text-amber-700",
                            )}
                          >
                            {confidencePct}%
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-foreground mb-3 min-h-[1.25rem]">
                          {e.rawValue ?? "—"}
                        </p>
                        {e.sourceText && (
                          <p className="mb-3 truncate text-xs italic text-muted-foreground">
                            &quot;{e.sourceText}&quot;
                          </p>
                        )}
                        {!accepted && !rejected && (
                          <div className="flex gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-xs flex-1"
                              onClick={() => handleExtraction(e.id, "accept")}
                            >
                              Accept
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-xs flex-1"
                              onClick={() => handleExtraction(e.id, "reject")}
                            >
                              Reject
                            </Button>
                          </div>
                        )}
                        {accepted && (
                          <div className="flex items-center gap-1 text-xs text-emerald-600">
                            <Check className="size-3" />
                            Accepted
                          </div>
                        )}
                        {rejected && (
                          <span className="text-xs text-muted-foreground">Rejected</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </TabsContent>

        {/* Approvals */}
        <TabsContent value="approvals" className="flex-1 overflow-auto m-0 border-0">
          <div className="p-7">
            <div className="rounded-[var(--radius)] border border-border bg-card p-5">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-medium text-foreground">Approval Workflow</h3>
                {canRequestApproval && (
                  <Button size="sm" onClick={() => setApprovalOpen(true)}>
                    <UserCheck className="size-4" />
                    Request Approval
                  </Button>
                )}
              </div>

              {approvals.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">
                  No approvals requested yet
                </p>
              ) : (
                <div className="relative">
                  {approvals.map((approval, idx) => {
                    const isPending = approval.status === "pending"
                    const isDone = approval.status === "approved"
                    const isMyApproval = approval.assignedToId === session?.user?.id && isPending
                    const isDeciding = deciding?.id === approval.id
                    const isLast = idx === approvals.length - 1

                    return (
                      <div key={approval.id} className="relative flex gap-4">
                        <div className="flex flex-col items-center shrink-0">
                          <div
                            className={cn(
                              "flex size-8 items-center justify-center rounded-full text-xs font-semibold z-10",
                              isDone && "bg-emerald-100 text-emerald-700",
                              isPending && "bg-amber-100 text-amber-700",
                              !isDone && !isPending && "bg-muted text-muted-foreground",
                            )}
                          >
                            {isDone ? (
                              <Check className="size-4" />
                            ) : (
                              approval.assignedTo.name.charAt(0).toUpperCase()
                            )}
                          </div>
                          {!isLast && (
                            <div
                              className={cn(
                                "w-px flex-1 my-1",
                                isDone ? "bg-emerald-200" : "bg-border",
                              )}
                              style={{ minHeight: "2rem" }}
                            />
                          )}
                        </div>

                        <div className={cn("flex-1 pb-5", isLast && "pb-0")}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-foreground">{approval.assignedTo.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {isDone ? "Approved" : isPending ? "Waiting for review" : "Rejected"} · Requested by{" "}
                                {approval.requestedBy.name} · <RelativeTime date={approval.createdAt} />
                              </p>
                            </div>
                            {approval.status === "pending" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 shrink-0">
                                <Clock className="size-3" />
                                Pending
                              </span>
                            )}
                            {approval.status === "approved" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 shrink-0">
                                <CheckCircle className="size-3" />
                                Approved
                              </span>
                            )}
                            {approval.status === "rejected" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 shrink-0">
                                <XCircle className="size-3" />
                                Rejected
                              </span>
                            )}
                          </div>

                          {approval.comment && (
                            <p className="mt-1.5 text-sm text-muted-foreground">{approval.comment}</p>
                          )}
                          {approval.decidedAt && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Decided <RelativeTime date={approval.decidedAt} />
                            </p>
                          )}

                          {isMyApproval && !isDeciding && (
                            <div className="flex gap-2 mt-2">
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

                          {isMyApproval && isDeciding && (
                            <div className="mt-2 space-y-2">
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
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="mt-5 pt-4 border-t border-border">
                <Link href={`/contracts/${id}/approval`}>
                  <Button size="sm" className="w-full sm:w-auto">
                    View Full Workflow
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Signing */}
        <TabsContent value="signing" className="flex-1 overflow-auto m-0 border-0">
          <div className="p-7">
            <div className="rounded-[var(--radius)] border border-border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                    DocuSeal
                  </span>
                  <p className="text-sm font-medium text-foreground">
                    {contract.signingStatus === "completed"
                      ? "All signatures collected"
                      : contract.signingStatus === "sent"
                      ? "Awaiting signatures"
                      : "Signing not started"}
                  </p>
                </div>
                <Link href={`/contracts/${id}/signing`}>
                  <Button size="sm" variant="outline">
                    Manage Signing
                  </Button>
                </Link>
              </div>

              {contract.signingStatus && (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs text-muted-foreground">Signature progress</p>
                      <p className="text-xs font-medium text-foreground">
                        {contract.signingStatus === "completed" ? "100%" : contract.signingStatus === "sent" ? "In progress" : "0%"}
                      </p>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: contract.signingStatus === "completed" ? "100%" : contract.signingStatus === "sent" ? "33%" : "0%" }}
                      />
                    </div>
                  </div>

                  <div className="rounded-[var(--radius)] border border-border divide-y divide-border">
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                          {contract.owner?.name.charAt(0).toUpperCase() ?? "?"}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{contract.owner?.name ?? "Owner"}</p>
                          <p className="text-xs text-muted-foreground">{contract.owner?.email ?? ""}</p>
                        </div>
                      </div>
                      <SigningStatusBadge status={contract.signingStatus} />
                    </div>
                  </div>
                </>
              )}

              {!contract.signingStatus && (
                <div className="flex flex-col items-center py-8 gap-3">
                  <p className="text-sm text-muted-foreground">
                    This contract has not been sent for signature yet.
                  </p>
                  {canSendForSignature && (
                    <Button size="sm" disabled={sendingForSignature} onClick={sendForSignature}>
                      <Send className="size-4" />
                      {sendingForSignature ? "Sending..." : "Send for Signature"}
                    </Button>
                  )}
                </div>
              )}

              {contract.signingUrl && contract.signingStatus === "sent" && (
                <a
                  href={contract.signingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  Open signing link <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Q&A */}
        <TabsContent value="qa" className="flex-1 overflow-auto m-0 border-0">
          <div className="p-7">
            <div className="rounded-[var(--radius)] border border-border bg-card p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground">Questions &amp; Answers</h3>
                <span className="text-xs text-muted-foreground">{qaThreads.length} thread{qaThreads.length !== 1 ? "s" : ""}</span>
              </div>

              <div className="space-y-4">
                {qaThreads.map((thread) => (
                  <div key={thread.id} className="rounded-[var(--radius)] border border-border overflow-hidden">
                    <div className="bg-muted/40 px-4 py-2.5">
                      <p className="text-sm font-medium text-foreground">{thread.question}</p>
                    </div>
                    <div className="divide-y divide-border">
                      {thread.answers.map((answer, idx) => (
                        <div key={idx} className="flex gap-3 px-4 py-3">
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                            {answer.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground mb-0.5">{answer.name}</p>
                            <p className="text-sm text-muted-foreground">{answer.text}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {qaThreads.length === 0 && (
                  <div className="flex flex-col items-center py-8 gap-2">
                    <MessageSquare className="size-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">No questions yet</p>
                  </div>
                )}
              </div>

              {/* Ask AI inline */}
              {contract.hasExtractedText && (
                <div className="rounded-md bg-muted/30 border border-border p-3">
                  <p className="text-xs font-medium text-foreground mb-2">Ask AI about this contract</p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="e.g. What is the notice period?"
                      value={aiQuestion}
                      onChange={(e) => setAiQuestion(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") askAI() }}
                      className="flex-1 text-sm"
                      disabled={askingAI}
                    />
                    <Button size="sm" onClick={askAI} disabled={!aiQuestion.trim() || askingAI}>
                      {askingAI ? "Thinking..." : "Ask"}
                    </Button>
                  </div>
                  {aiAnswer && (
                    <div className="mt-3 rounded-md bg-card border border-border p-3">
                      <p className="whitespace-pre-wrap text-sm text-foreground">{aiAnswer}</p>
                      {aiCitations.length > 0 && (
                        <div className="mt-3 border-t border-border pt-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sources</p>
                          <div className="mt-2 space-y-2">
                            {aiCitations.map((citation) => (
                              <details key={citation.chunkIndex} className="rounded border border-border bg-muted/30 px-3 py-2">
                                <summary className="cursor-pointer text-xs font-medium text-foreground">
                                  Excerpt {citation.chunkIndex + 1}
                                  {citation.similarity != null && (
                                    <span className="ml-2 text-muted-foreground">
                                      {(citation.similarity * 100).toFixed(0)}% match
                                    </span>
                                  )}
                                </summary>
                                <p className="mt-2 line-clamp-6 whitespace-pre-wrap text-xs text-foreground/80">
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

              <div className="flex gap-2 pt-2 border-t border-border">
                <Input
                  placeholder="Ask a question about this contract..."
                  value={qaInput}
                  onChange={(e) => setQaInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && qaInput.trim()) {
                      setQaThreads((prev) => [
                        ...prev,
                        { id: `q-${Date.now()}`, question: qaInput.trim(), answers: [] },
                      ])
                      setQaInput("")
                    }
                  }}
                  className="flex-1 text-sm"
                />
                <Button
                  size="sm"
                  disabled={!qaInput.trim()}
                  onClick={() => {
                    if (!qaInput.trim()) return
                    setQaThreads((prev) => [
                      ...prev,
                      { id: `q-${Date.now()}`, question: qaInput.trim(), answers: [] },
                    ])
                    setQaInput("")
                  }}
                >
                  Ask
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Editor */}
        <TabsContent value="editor" className="flex-1 overflow-auto m-0 border-0">
          <div className="p-7">
            <EditorTab
              contractId={contract.id}
              contractStatus={contract.status}
              role={currentMember?.role ?? "member"}
            />
          </div>
        </TabsContent>

        {/* Obligations */}
        <TabsContent value="obligations" className="flex-1 overflow-auto m-0 border-0">
          <div className="p-7">
            <ObligationList
              contractId={contract.id}
              obligations={obligations}
              members={members}
              contractArchived={contract.status === "ARCHIVED"}
              role={currentMember?.role}
              onChange={setObligations}
            />
          </div>
        </TabsContent>
      </Tabs>

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

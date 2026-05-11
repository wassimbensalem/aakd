"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "@/lib/auth/client"
import Link from "next/link"
import { toast } from "sonner"
import { format } from "date-fns"
import {
  ArrowLeft,
  Shield,
  Check,
  Clock,
  AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { Contract, Approval } from "@/lib/types"

// ─── Types ────────────────────────────────────────────────────────────────────

type ApprovalStep = Approval & {
  position: number
}

type ActionState = "idle" | "loading" | "success" | "error"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

// ─── Step Avatar ─────────────────────────────────────────────────────────────

function StepAvatar({
  status,
  name,
}: {
  status: "approved" | "pending" | "waiting" | "rejected"
  name: string
}) {
  if (status === "approved") {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 ring-2 ring-emerald-300">
        <Check className="h-5 w-5 text-emerald-700" strokeWidth={2.5} />
      </div>
    )
  }

  if (status === "rejected") {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 ring-2 ring-rose-300">
        <AlertCircle className="h-5 w-5 text-rose-700" strokeWidth={2.5} />
      </div>
    )
  }

  if (status === "pending") {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 ring-2 ring-amber-300">
        <span className="text-sm font-bold text-amber-800">{getInitials(name)}</span>
      </div>
    )
  }

  // waiting
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted ring-2 ring-border">
      <span className="text-sm font-bold text-muted-foreground">{getInitials(name)}</span>
    </div>
  )
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function ApprovalBadge({ status }: { status: "approved" | "pending" | "waiting" | "rejected" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        status === "approved" && "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
        status === "pending" && "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
        status === "waiting" && "bg-muted text-muted-foreground ring-1 ring-border",
        status === "rejected" && "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
      )}
    >
      {status === "approved" && "Approved"}
      {status === "pending" && "Pending"}
      {status === "waiting" && "Waiting"}
      {status === "rejected" && "Rejected"}
    </span>
  )
}

// ─── Connector Line ───────────────────────────────────────────────────────────

function ConnectorLine({ isComplete }: { isComplete: boolean }) {
  return (
    <div className="ml-5 mt-1 mb-1 w-0.5 h-8 rounded-full" style={{
      backgroundColor: isComplete ? "hsl(148 58% 30%)" : "hsl(215 10% 90%)",
    }} />
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ contractId }: { contractId: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
        <Shield className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">No Approval Workflow</h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-xs">
        This contract has no approval workflow configured.
      </p>
      <Link href={`/contracts/${contractId}`}>
        <Button variant="outline">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back to Contract
        </Button>
      </Link>
    </div>
  )
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
        <div className="md:col-span-2 space-y-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  )
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function ApprovalPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { data: session } = useSession()

  const [contract, setContract] = useState<Contract | null>(null)
  const [approvals, setApprovals] = useState<ApprovalStep[]>([])
  const [loading, setLoading] = useState(true)
  const [hasWorkflow, setHasWorkflow] = useState(true)
  const [comment, setComment] = useState("")
  const [actionState, setActionState] = useState<ActionState>("idle")
  const [actionMessage, setActionMessage] = useState("")

  const currentUserId = session?.user?.id

  const fetchData = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      try {
        const [contractRes, approvalsRes] = await Promise.all([
          fetch(`/api/contracts/${id}`, { signal }),
          fetch(`/api/contracts/${id}/approvals`, { signal }),
        ])

        if (!contractRes.ok) {
          router.replace("/contracts")
          return
        }

        const contractData = await contractRes.json()
        setContract(contractData.contract ?? contractData)

        if (!approvalsRes.ok || approvalsRes.status === 404) {
          setHasWorkflow(false)
          return
        }

        const approvalsData = await approvalsRes.json()
        const list: Approval[] = approvalsData.approvals ?? []

        if (list.length === 0) {
          setHasWorkflow(false)
          return
        }

        setApprovals(
          list.map((a, i) => ({ ...a, position: i + 1 }))
        )
        setHasWorkflow(true)
      } catch (e) {
        if ((e as Error).name === "AbortError") return
        setHasWorkflow(false)
      } finally {
        setLoading(false)
      }
    },
    [id, router]
  )

  useEffect(() => {
    const controller = new AbortController()
    fetchData(controller.signal)
    return () => controller.abort()
  }, [fetchData])

  // Determine if the current user is the active pending approver
  const pendingApproval = approvals.find(
    (a) => a.status === "pending" && a.assignedToId === currentUserId
  )

  async function handleAction(intent: "approve" | "reject") {
    if (!pendingApproval) return
    setActionState("loading")

    const endpoint = `/api/contracts/${id}/approvals/${pendingApproval.id}`

    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: intent === "approve" ? "approved" : "rejected",
          comment: comment.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? "Action failed")
      }

      const label = intent === "approve" ? "Approved" : "Rejected"

      setActionState("success")
      setActionMessage(`${label} successfully.`)
      toast.success(`${label} successfully`)
      fetchData()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Action failed"
      setActionState("error")
      setActionMessage(msg)
      toast.error(msg)
    }
  }

  // Derive display status for each approval step
  function getStepStatus(
    approval: ApprovalStep
  ): "approved" | "pending" | "waiting" | "rejected" {
    if (approval.status === "approved") return "approved"
    if (approval.status === "rejected") return "rejected"
    // "pending" in the data means this person is the current approver
    if (approval.status === "pending") return "pending"
    // If it's still "pending" but a later step, treat it as waiting
    return "waiting"
  }

  function getActionText(approval: ApprovalStep): string {
    if (approval.status === "approved") return "Approved"
    if (approval.status === "rejected") return "Rejected"
    if (approval.status === "pending") return "Awaiting review"
    return "Queued"
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Page header */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center gap-4">
          <Link href={`/contracts/${id}`}>
            <Button variant="ghost" size="icon-sm">
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back to contract</span>
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-foreground leading-tight">
              Approval Workflow
            </h1>
            {contract && (
              <p className="text-sm text-muted-foreground truncate mt-0.5">
                {contract.title}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-5xl px-6 py-8">
        {loading ? (
          <LoadingSkeleton />
        ) : !hasWorkflow || approvals.length === 0 ? (
          <EmptyState contractId={id} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Left — Timeline */}
            <div className="md:col-span-2">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-6">
                Approval Timeline
              </h2>

              <div className="relative">
                {approvals.map((approval, idx) => {
                  const stepStatus = getStepStatus(approval)
                  const isLast = idx === approvals.length - 1
                  const prevComplete =
                    idx > 0 &&
                    (approvals[idx - 1].status === "approved")

                  return (
                    <div key={approval.id}>
                      {/* Connector line above (except for first) */}
                      {idx > 0 && (
                        <ConnectorLine isComplete={prevComplete} />
                      )}

                      {/* Step row */}
                      <div className="flex items-start gap-4">
                        <StepAvatar
                          status={stepStatus}
                          name={approval.assignedTo?.name ?? "Approver"}
                        />

                        <div className="flex-1 min-w-0 pb-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-foreground">
                              {approval.assignedTo?.name ?? "Approver"}
                            </span>
                            <ApprovalBadge status={stepStatus} />
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {approval.assignedTo?.email}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="text-xs text-muted-foreground">
                              {getActionText(approval)}
                              {approval.decidedAt && (
                                <span className="ml-1 text-muted-foreground/70">
                                  &mdash;{" "}
                                  {format(new Date(approval.decidedAt), "MMM d, yyyy 'at' h:mm a")}
                                </span>
                              )}
                            </span>
                          </div>
                          {approval.comment && (
                            <p className="mt-1.5 text-xs text-foreground/80 bg-muted rounded-md px-2.5 py-1.5 border border-border">
                              {approval.comment}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Connector line below (except for last) */}
                      {!isLast && (
                        <ConnectorLine isComplete={stepStatus === "approved"} />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Right — Action Panel */}
            {pendingApproval ? (
              <div className="md:col-span-1">
                <Card>
                  <CardHeader>
                    <CardTitle>Your Decision</CardTitle>
                    <CardDescription>
                      You are the current approver for this request
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Comment textarea */}
                    <div className="space-y-1.5">
                      <label
                        htmlFor="approval-comment"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Add a comment (optional)
                      </label>
                      <Textarea
                        id="approval-comment"
                        placeholder="Share your reasoning..."
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        rows={3}
                        disabled={actionState === "loading" || actionState === "success"}
                        className="text-sm resize-none"
                      />
                    </div>

                    {/* Inline feedback */}
                    {actionState === "success" && (
                      <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                        <Check className="h-4 w-4 shrink-0" />
                        {actionMessage}
                      </div>
                    )}
                    {actionState === "error" && (
                      <div className="flex items-center gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        {actionMessage}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex flex-col gap-2">
                      <Button
                        className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                        disabled={actionState === "loading" || actionState === "success"}
                        onClick={() => handleAction("approve")}
                      >
                        {actionState === "loading" ? "Processing..." : "Approve"}
                      </Button>
                      <Button
                        variant="destructive"
                        className="w-full"
                        disabled={actionState === "loading" || actionState === "success"}
                        onClick={() => handleAction("reject")}
                      >
                        Reject
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              // Spacer / info card when user is not the active approver
              <div className="md:col-span-1">
                <Card>
                  <CardContent className="pt-6 pb-4 flex flex-col items-center text-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                      <Shield className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      You are not the current approver for this workflow.
                    </p>
                    <Link href={`/contracts/${id}`}>
                      <Button variant="outline" size="sm">Back to Contract</Button>
                    </Link>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

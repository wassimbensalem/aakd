"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { format } from "date-fns"
import {
  ArrowLeft,
  Pen,
  Plus,
  Send,
  Bell,
  CheckCircle2,
  Clock,
  MailOpen,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { Contract } from "@/lib/types"

// ─── Types ────────────────────────────────────────────────────────────────────

type SignerStatus = "signed" | "pending" | "not_sent"

interface Signer {
  id: string
  name: string
  email: string
  status: SignerStatus
  signedAt?: string | null
}

interface SigningData {
  totalSigners: number
  collectedSignatures: number
  signers: Signer[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SignerStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        status === "signed" &&
          "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
        status === "pending" &&
          "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
        status === "not_sent" &&
          "bg-muted text-muted-foreground ring-1 ring-border",
      )}
    >
      {status === "signed" && (
        <>
          <CheckCircle2 className="h-3 w-3" />
          Signed
        </>
      )}
      {status === "pending" && (
        <>
          <Clock className="h-3 w-3" />
          Pending
        </>
      )}
      {status === "not_sent" && (
        <>
          <MailOpen className="h-3 w-3" />
          Not Sent
        </>
      )}
    </span>
  )
}

// ─── DocuSeal pill ────────────────────────────────────────────────────────────

function DocuSealPill() {
  return (
    <span className="inline-flex items-center rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700 ring-1 ring-sky-200">
      DocuSeal
    </span>
  )
}

// ─── Signer Row ───────────────────────────────────────────────────────────────

function SignerRow({
  signer,
  contractId: _contractId,
  onAction,
}: {
  signer: Signer
  contractId: string
  onAction: (signerId: string, action: "remind" | "send") => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      {/* Pen icon */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <Pen className="h-3.5 w-3.5 text-muted-foreground" />
      </div>

      {/* Name + email */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{signer.name}</p>
        <p className="text-xs text-muted-foreground truncate">{signer.email}</p>
        {signer.status === "signed" && signer.signedAt && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {format(new Date(signer.signedAt), "MMM d, yyyy 'at' h:mm a")}
          </p>
        )}
      </div>

      {/* Status badge */}
      <StatusBadge status={signer.status} />

      {/* Action button */}
      {signer.status === "pending" && (
        // TODO: DocuSeal API
        <Button
          variant="outline"
          size="sm"
          onClick={() => onAction(signer.id, "remind")}
          className="shrink-0"
        >
          <Bell className="h-3.5 w-3.5 mr-1" />
          Remind
        </Button>
      )}
      {signer.status === "not_sent" && (
        // TODO: DocuSeal API
        <Button
          size="sm"
          onClick={() => onAction(signer.id, "send")}
          className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Send className="h-3.5 w-3.5 mr-1" />
          Send
        </Button>
      )}
    </div>
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ contractId }: { contractId: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
        <Pen className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">
        No Signing Workflow
      </h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-xs">
        No signing workflow is configured for this contract.
      </p>
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <Link href={`/contracts/${contractId}`}>
          <Button variant="outline">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back to Contract
          </Button>
        </Link>
        <div className="relative">
          <Button disabled className="opacity-50 cursor-not-allowed">
            <Send className="h-4 w-4 mr-1.5" />
            Send for Signature
          </Button>
          <span className="absolute -top-2 -right-2 text-[9px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full border border-border">
            Soon
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-24 rounded-xl" />
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    </div>
  )
}

// ─── Add Signer Form ──────────────────────────────────────────────────────────

function AddSignerForm() {
  return (
    <div className="relative">
      {/* Soon overlay */}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl bg-background/80 backdrop-blur-sm border border-border">
        <span className="text-sm font-semibold text-muted-foreground mb-1">
          Coming Soon
        </span>
        <p className="text-xs text-muted-foreground">DocuSeal integration required</p>
      </div>

      {/* Behind overlay — disabled form */}
      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3 opacity-50 pointer-events-none select-none">
        <div className="space-y-1">
          <Label htmlFor="new-signer-name" className="text-xs">
            Name
          </Label>
          <Input id="new-signer-name" placeholder="Jane Smith" disabled />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-signer-email" className="text-xs">
            Email
          </Label>
          <Input
            id="new-signer-email"
            type="email"
            placeholder="jane@example.com"
            disabled
          />
        </div>
        <Button disabled size="sm">
          Add Signer
        </Button>
      </div>
    </div>
  )
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function SigningPage() {
  const { id } = useParams<{ id: string }>()

  const [contract, setContract] = useState<Contract | null>(null)
  const [signingData, setSigningData] = useState<SigningData | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasWorkflow, setHasWorkflow] = useState(true)
  const [showAddSigner, setShowAddSigner] = useState(false)

  const fetchData = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      try {
        const [contractRes, signingRes] = await Promise.all([
          fetch(`/api/contracts/${id}`, { signal }),
          fetch(`/api/contracts/${id}/signing`, { signal }),
        ])

        if (!contractRes.ok) return

        const contractData = await contractRes.json()
        setContract(contractData.contract ?? contractData)

        if (!signingRes.ok || signingRes.status === 404) {
          setHasWorkflow(false)
          return
        }

        const signingJson = await signingRes.json()
        const signers: Signer[] = signingJson.signers ?? []

        if (signers.length === 0) {
          setHasWorkflow(false)
          return
        }

        setSigningData({
          signers,
          totalSigners: signingJson.totalSigners ?? signers.length,
          collectedSignatures:
            signingJson.collectedSignatures ??
            signers.filter((s) => s.status === "signed").length,
        })
        setHasWorkflow(true)
      } catch (e) {
        if ((e as Error).name === "AbortError") return
        setHasWorkflow(false)
      } finally {
        setLoading(false)
      }
    },
    [id]
  )

  useEffect(() => {
    const controller = new AbortController()
    fetchData(controller.signal)
    return () => controller.abort()
  }, [fetchData])

  async function handleSignerAction(signerId: string, action: "remind" | "send") {
    // TODO: DocuSeal API
    const endpoint =
      action === "remind"
        ? `/api/contracts/${id}/signing/remind`
        : `/api/contracts/${id}/signing/send`

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signerId }),
      })

      if (!res.ok) {
        toast.info("Coming soon — DocuSeal integration pending")
        return
      }

      toast.success(action === "remind" ? "Reminder sent" : "Signature request sent")
      fetchData()
    } catch {
      toast.info("Coming soon — DocuSeal integration pending")
    }
  }

  const progress =
    signingData && signingData.totalSigners > 0
      ? Math.round(
          (signingData.collectedSignatures / signingData.totalSigners) * 100
        )
      : 0

  return (
    <div className="min-h-screen bg-background">
      {/* Page header */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center gap-4">
          <Link href={`/contracts/${id}`}>
            <Button variant="ghost" size="icon-sm">
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back to contract</span>
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-foreground leading-tight">
              Signing Workflow
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
      <div className="mx-auto max-w-3xl px-6 py-8">
        {loading ? (
          <LoadingSkeleton />
        ) : !hasWorkflow || !signingData ? (
          <EmptyState contractId={id} />
        ) : (
          <div className="space-y-6">
            {/* Summary card */}
            <Card>
              <CardContent className="pt-4 pb-4 space-y-3">
                {/* DocuSeal badge + progress text */}
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <DocuSealPill />
                  <span className="text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {signingData.collectedSignatures}
                    </span>{" "}
                    of{" "}
                    <span className="font-semibold text-foreground">
                      {signingData.totalSigners}
                    </span>{" "}
                    signatures collected
                  </span>
                </div>

                {/* Progress bar */}
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${progress}%`,
                      backgroundColor: "hsl(148 58% 30%)",
                    }}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Signer list */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Signers
              </h2>
              {signingData.signers.map((signer) => (
                <SignerRow
                  key={signer.id}
                  signer={signer}
                  contractId={id}
                  onAction={handleSignerAction}
                />
              ))}
            </div>

            {/* Add signer */}
            <div className="space-y-3">
              {!showAddSigner ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddSigner(true)}
                  className="gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  Add Signer
                </Button>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-foreground">
                      Add New Signer
                    </h3>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setShowAddSigner(false)}
                      className="text-muted-foreground"
                    >
                      Cancel
                    </Button>
                  </div>
                  <AddSignerForm />
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

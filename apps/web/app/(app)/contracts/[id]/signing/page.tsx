"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { format } from "date-fns"
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  Clock,
  MailOpen,
  RotateCcw,
  Send,
  Plus,
  X,
  XCircle,
  Loader2,
  AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { Contract } from "@/lib/types"

// ─── Types ────────────────────────────────────────────────────────────────────

type SignerStatus = "signed" | "pending" | "not_sent" | "declined"

interface Signer {
  id: string
  name: string
  email: string
  isInternal: boolean
  status: SignerStatus
  signedAt?: string | null
  externalId?: string | null
}

interface SigningData {
  signers: Signer[]
  submissionId: string | null
  signingStatus: string | null
  collectedSignatures: number
  totalSigners: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function StatusBadge({ status }: { status: SignerStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        status === "signed" && "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
        status === "pending" && "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
        status === "not_sent" && "bg-muted text-muted-foreground ring-1 ring-border",
        status === "declined" && "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
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
      {status === "declined" && (
        <>
          <XCircle className="h-3 w-3" />
          Declined
        </>
      )}
    </span>
  )
}

function RoleBadge({ isInternal }: { isInternal: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        isInternal
          ? "bg-violet-50 text-violet-700 ring-1 ring-violet-200"
          : "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
      )}
    >
      {isInternal ? "Internal" : "External"}
    </span>
  )
}

function DocuSealBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700 ring-1 ring-sky-200">
      DocuSeal
    </span>
  )
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-20 rounded-xl" />
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
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

  // Add signer form state
  const [newName, setNewName] = useState("")
  const [newEmail, setNewEmail] = useState("")
  const [newIsInternal, setNewIsInternal] = useState(false)
  const [addingSignerLoading, setAddingSignerLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)

  // Sending state
  const [sending, setSending] = useState(false)

  // Track which signers are being reminded
  const [remindingIds, setRemindingIds] = useState<Set<string>>(new Set())

  // Resetting state
  const [resetting, setResetting] = useState(false)

  // Track counterparty auto-populate attempt
  const autoPopulatedRef = useRef(false)

  const fetchSigningData = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [contractRes, signingRes] = await Promise.all([
          fetch(`/api/contracts/${id}`, { signal }),
          fetch(`/api/contracts/${id}/signing`, { signal }),
        ])

        if (!contractRes.ok) return

        const contractJson = await contractRes.json()
        const contractData: Contract = contractJson.contract ?? contractJson
        setContract(contractData)

        if (signingRes.ok) {
          const signingJson = await signingRes.json()
          setSigningData(signingJson as SigningData)
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return
      } finally {
        setLoading(false)
      }
    },
    [id],
  )

  useEffect(() => {
    const controller = new AbortController()
    fetchSigningData(controller.signal)
    return () => controller.abort()
  }, [fetchSigningData])

  // Auto-populate counterparty on first load
  useEffect(() => {
    if (
      !autoPopulatedRef.current &&
      signingData !== null &&
      signingData.submissionId === null &&
      signingData.signers.length === 0 &&
      contract?.counterpartyContact
    ) {
      autoPopulatedRef.current = true
      void addSigner(
        contract.counterpartyName ?? "Counterparty",
        contract.counterpartyContact,
        false,
      )
    }
  }, [signingData, contract]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addSigner(name: string, email: string, isInternal: boolean) {
    const res = await fetch(`/api/contracts/${id}/signing/signers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, isInternal }),
    })

    if (res.status === 409) {
      const err = await res.json().catch(() => ({}))
      toast.error(err.error ?? "A signer with this email already exists")
      return
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast.error(err.error ?? "Failed to add signer")
      return
    }

    await fetchSigningData()
  }

  async function handleAddSigner() {
    if (!newName.trim() || !newEmail.trim()) {
      toast.error("Name and email are required")
      return
    }
    setAddingSignerLoading(true)
    try {
      await addSigner(newName.trim(), newEmail.trim(), newIsInternal)
      setNewName("")
      setNewEmail("")
      setNewIsInternal(false)
      setShowAddForm(false)
    } finally {
      setAddingSignerLoading(false)
    }
  }

  async function handleRemoveSigner(signerId: string) {
    const res = await fetch(`/api/contracts/${id}/signing/signers/${signerId}`, {
      method: "DELETE",
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast.error(err.error ?? "Failed to remove signer")
      return
    }
    await fetchSigningData()
  }

  async function handleSend() {
    setSending(true)
    try {
      const res = await fetch(`/api/contracts/${id}/signing/send`, { method: "POST" })
      if (res.ok) {
        const signerCount = signingData?.signers.length ?? 0
        toast.success(`Sent for signature to ${signerCount} signer${signerCount !== 1 ? "s" : ""}`)
        await fetchSigningData()
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? "Failed to send for signature")
      }
    } catch {
      toast.error("Failed to send for signature")
    } finally {
      setSending(false)
    }
  }

  async function handleRemind(signerId: string) {
    setRemindingIds((prev) => new Set(prev).add(signerId))
    try {
      const res = await fetch(`/api/contracts/${id}/signing/remind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signerId }),
      })
      if (res.ok) {
        toast.success("Reminder sent")
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? "Failed to send reminder")
      }
    } catch {
      toast.error("Failed to send reminder")
    } finally {
      setRemindingIds((prev) => {
        const next = new Set(prev)
        next.delete(signerId)
        return next
      })
    }
  }

  async function handleReset() {
    setResetting(true)
    try {
      const res = await fetch(`/api/contracts/${id}/signing/reset`, { method: "POST" })
      if (res.ok) {
        toast.success("Signing reset — you can now reconfigure signers and re-send")
        await fetchSigningData()
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? "Failed to reset signing")
      }
    } catch {
      toast.error("Failed to reset signing")
    } finally {
      setResetting(false)
    }
  }

  // Derived state
  const isPreSend = signingData?.submissionId === null
  const signers = signingData?.signers ?? []
  const collectedSignatures = signingData?.collectedSignatures ?? 0
  const totalSigners = signingData?.totalSigners ?? 0
  const progress = totalSigners > 0 ? Math.round((collectedSignatures / totalSigners) * 100) : 0

  const signingStatus = signingData?.signingStatus ?? null
  const isResettable =
    signingStatus === "declined" || signingStatus === "expired" || signingStatus === "failed"

  const notAwaitingSignature =
    contract !== null && contract.status !== "AWAITING_SIGNATURE"

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
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-foreground leading-tight">
                Signing Workflow
              </h1>
              <DocuSealBadge />
            </div>
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
        ) : isPreSend ? (
          // ── State A: Pre-send ──────────────────────────────────────────────
          <div className="space-y-6">
            {notAwaitingSignature && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Contract must be in <strong>Awaiting Signature</strong> status before sending.
                </span>
              </div>
            )}

            {/* Signer list */}
            {signers.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Signers
                </h2>
                {signers.map((signer) => (
                  <div
                    key={signer.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
                  >
                    {/* Avatar */}
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                      {avatarInitials(signer.name)}
                    </div>

                    {/* Name + email */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {signer.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{signer.email}</p>
                    </div>

                    <RoleBadge isInternal={signer.isInternal} />

                    {/* Remove button */}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleRemoveSigner(signer.id)}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${signer.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Add Signer section */}
            <div className="space-y-3">
              {!showAddForm ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddForm(true)}
                  className="gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  Add Signer
                </Button>
              ) : (
                <Card>
                  <CardContent className="pt-4 pb-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-foreground">Add Signer</h3>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          setShowAddForm(false)
                          setNewName("")
                          setNewEmail("")
                          setNewIsInternal(false)
                        }}
                        className="text-muted-foreground"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="signer-name" className="text-xs">
                        Name
                      </Label>
                      <Input
                        id="signer-name"
                        placeholder="Jane Smith"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="signer-email" className="text-xs">
                        Email
                      </Label>
                      <Input
                        id="signer-email"
                        type="email"
                        placeholder="jane@example.com"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleAddSigner()
                        }}
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        id="signer-internal"
                        type="checkbox"
                        className="h-4 w-4 rounded border-border"
                        checked={newIsInternal}
                        onChange={(e) => setNewIsInternal(e.target.checked)}
                      />
                      <Label htmlFor="signer-internal" className="text-xs cursor-pointer">
                        Internal org member
                      </Label>
                    </div>

                    <Button
                      size="sm"
                      onClick={handleAddSigner}
                      disabled={addingSignerLoading || !newName.trim() || !newEmail.trim()}
                    >
                      {addingSignerLoading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                      Add Signer
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Send for Signature */}
            <div className="pt-2">
              <Button
                size="sm"
                disabled={signers.length === 0 || sending || notAwaitingSignature}
                onClick={handleSend}
                className="gap-1.5"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {sending ? "Sending..." : "Send for Signature"}
              </Button>
              {signers.length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Add at least one signer before sending.
                </p>
              )}
            </div>
          </div>
        ) : (
          // ── State B: Post-send ─────────────────────────────────────────────
          <div className="space-y-6">
            {/* Declined / expired / failed banner */}
            {isResettable && (
              <div className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">
                    {signingStatus === "declined" && "Signing declined"}
                    {signingStatus === "expired" && "Signing expired"}
                    {signingStatus === "failed" && "Signing failed"}
                  </p>
                  <p className="mt-0.5 text-rose-700/80 text-xs">
                    {signingStatus === "declined" &&
                      "One or more signers declined to sign. Reset the workflow below to reconfigure and re-send."}
                    {signingStatus === "expired" &&
                      "The signing request expired before all signers responded. Reset the workflow to re-send."}
                    {signingStatus === "failed" &&
                      "Signing failed due to an error. Reset the workflow to try again."}
                  </p>
                </div>
              </div>
            )}

            {/* Progress card */}
            <Card>
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <DocuSealBadge />
                  <span className="text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">{collectedSignatures}</span>
                    {" "}of{" "}
                    <span className="font-semibold text-foreground">{totalSigners}</span>
                    {" "}signatures collected
                  </span>
                </div>

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
              {signers.map((signer) => (
                <div
                  key={signer.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
                >
                  {/* Avatar */}
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                    {avatarInitials(signer.name)}
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

                  <RoleBadge isInternal={signer.isInternal} />
                  <StatusBadge status={signer.status} />

                  {/* Remind button — only for pending signers */}
                  {signer.status === "pending" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRemind(signer.id)}
                      disabled={remindingIds.has(signer.id)}
                      className="shrink-0"
                    >
                      {remindingIds.has(signer.id) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      ) : (
                        <Bell className="h-3.5 w-3.5 mr-1" />
                      )}
                      Remind
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {/* Back link + Reset */}
            <div className="pt-2 flex items-center gap-3 flex-wrap">
              <Link href={`/contracts/${id}`}>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <ArrowLeft className="h-4 w-4" />
                  Back to Contract
                </Button>
              </Link>
              {isResettable && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  disabled={resetting}
                  className="gap-1.5"
                >
                  {resetting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                  {resetting ? "Resetting..." : "Reset & Resend"}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

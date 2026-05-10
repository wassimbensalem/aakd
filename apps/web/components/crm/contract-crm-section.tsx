"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ExternalLink, Loader2, Plus, RefreshCw, Search, Unlink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  type CrmDealSummary,
  type CrmIntegrationStatus,
  type CrmLinkData,
  type CrmProvider,
  CRM_PROVIDERS,
} from "@/lib/types/crm"
import { RelativeTime } from "@/components/relative-time"

interface Props {
  contractId: string
  role?: string
}

const PROVIDER_LABELS: Record<CrmProvider, string> = {
  HUBSPOT: "HubSpot",
  SALESFORCE: "Salesforce",
  PIPEDRIVE: "Pipedrive",
}

export function ContractCrmSection({ contractId, role }: Props) {
  const [links, setLinks] = useState<CrmLinkData[]>([])
  const [integrations, setIntegrations] = useState<CrmIntegrationStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [confirmUnlinkId, setConfirmUnlinkId] = useState<string | null>(null)
  const [unlinking, setUnlinking] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)

  const canLink = role === "admin" || role === "legal" || role === "member"
  const canUnlinkOrSync = role === "admin" || role === "legal"

  async function fetchLinks() {
    try {
      const res = await fetch(`/api/contracts/${contractId}/crm-link`)
      if (!res.ok) throw new Error("links")
      const data = await res.json()
      setLinks(data.links ?? [])
    } catch {
      // silent — section just shows empty
    }
  }

  async function fetchStatus() {
    try {
      const res = await fetch("/api/crm/status")
      if (!res.ok) throw new Error("status")
      const data = await res.json()
      setIntegrations(data.integrations ?? [])
    } catch {
      // silent
    }
  }

  useEffect(() => {
    let active = true
    Promise.all([fetchLinks(), fetchStatus()]).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId])

  const connectedProviders = useMemo(
    () => new Set(integrations.map((i) => i.provider)),
    [integrations],
  )

  const linkedProviders = useMemo(
    () => new Set(links.map((l) => l.provider)),
    [links],
  )

  async function unlink(linkId: string) {
    setUnlinking(true)
    try {
      const res = await fetch(`/api/contracts/${contractId}/crm-link/${linkId}`, {
        method: "DELETE",
      })
      if (!res.ok && res.status !== 204) throw new Error()
      toast.success("Deal unlinked")
      setConfirmUnlinkId(null)
      fetchLinks()
    } catch {
      toast.error("Failed to unlink deal")
    } finally {
      setUnlinking(false)
    }
  }

  async function syncNow(link: CrmLinkData) {
    setSyncingId(link.id)
    try {
      const res = await fetch(
        `/api/crm/${link.provider.toLowerCase()}/sync/${contractId}`,
        { method: "POST" },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? "sync")
      }
      toast.success("Synced to CRM")
      fetchLinks()
    } catch (err) {
      toast.error(`Sync failed${err instanceof Error && err.message ? `: ${err.message}` : ""}`)
    } finally {
      setSyncingId(null)
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">CRM</p>
        {canLink && connectedProviders.size > 0 && links.length < 3 && (
          <button
            type="button"
            onClick={() => setLinkDialogOpen(true)}
            className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900"
          >
            <Plus className="size-3" />
            Link deal
          </button>
        )}
      </div>

      {loading ? (
        <p className="mt-3 text-xs text-zinc-400">Loading…</p>
      ) : connectedProviders.size === 0 ? (
        <div className="mt-3 text-xs text-zinc-500">
          No CRM connected.{" "}
          <Link href="/settings/integrations" className="text-indigo-600 hover:underline">
            Connect a CRM
          </Link>{" "}
          to link this contract to a deal.
        </div>
      ) : links.length === 0 ? (
        <div className="mt-3 text-xs text-zinc-500">
          Not linked to any deal.
          {canLink && (
            <>
              {" "}
              <button
                type="button"
                onClick={() => setLinkDialogOpen(true)}
                className="text-indigo-600 hover:underline"
              >
                Link to a CRM deal
              </button>
              .
            </>
          )}
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {links.map((link) => (
            <li
              key={link.id}
              className="rounded-md border border-zinc-200 bg-zinc-50/60 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center rounded bg-zinc-200/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-700">
                      {PROVIDER_LABELS[link.provider]}
                    </span>
                  </div>
                  <div className="mt-1.5 truncate text-sm font-medium text-zinc-900">
                    {link.externalDealUrl ? (
                      <a
                        href={link.externalDealUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        {link.externalDealName}
                        <ExternalLink className="size-3 text-zinc-400" />
                      </a>
                    ) : (
                      link.externalDealName
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {link.lastSyncedAt ? (
                      <>
                        Last synced <RelativeTime date={link.lastSyncedAt} />
                        {link.lastSyncStatus &&
                          link.lastSyncStatus !== "success" && (
                            <span className="ml-1 text-amber-600">
                              ({link.lastSyncStatus})
                            </span>
                          )}
                      </>
                    ) : (
                      "Not synced yet"
                    )}
                  </p>
                </div>
                {canUnlinkOrSync && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-zinc-400 hover:text-zinc-700"
                      onClick={() => syncNow(link)}
                      disabled={syncingId === link.id}
                      title="Sync now"
                    >
                      {syncingId === link.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-zinc-400 hover:text-red-600"
                      onClick={() => setConfirmUnlinkId(link.id)}
                      title="Unlink"
                    >
                      <Unlink className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <LinkDialog
        contractId={contractId}
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        connectedProviders={connectedProviders}
        linkedProviders={linkedProviders}
        onLinked={() => {
          setLinkDialogOpen(false)
          fetchLinks()
        }}
      />

      <Dialog
        open={!!confirmUnlinkId}
        onOpenChange={(open) => {
          if (!open) setConfirmUnlinkId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlink CRM deal?</DialogTitle>
            <DialogDescription>
              This contract will no longer be linked to the CRM deal. The deal in your CRM is not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmUnlinkId(null)}
              disabled={unlinking}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              className="border-red-200 text-red-600 hover:bg-red-50"
              onClick={() => confirmUnlinkId && unlink(confirmUnlinkId)}
              disabled={unlinking}
            >
              {unlinking ? "Unlinking..." : "Unlink"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface LinkDialogProps {
  contractId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  connectedProviders: Set<CrmProvider>
  linkedProviders: Set<CrmProvider>
  onLinked: () => void
}

function LinkDialog({
  contractId,
  open,
  onOpenChange,
  connectedProviders,
  linkedProviders,
  onLinked,
}: LinkDialogProps) {
  const availableProviders = CRM_PROVIDERS.filter((p) => connectedProviders.has(p.id))
  const firstAvailable = availableProviders.find((p) => !linkedProviders.has(p.id))?.id ??
    availableProviders[0]?.id

  const [provider, setProvider] = useState<CrmProvider | undefined>(firstAvailable)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<CrmDealSummary[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) {
      setProvider(firstAvailable)
      setQuery("")
      setResults([])
      setSelectedId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open || !provider) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void runSearch(provider, query)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, query, open])

  async function runSearch(p: CrmProvider, q: string) {
    setSearching(true)
    try {
      const url = new URL(
        `/api/crm/${p.toLowerCase()}/deals`,
        typeof window !== "undefined" ? window.location.origin : "http://localhost",
      )
      if (q) url.searchParams.set("q", q)
      const res = await fetch(url.pathname + url.search)
      if (!res.ok) throw new Error("deals")
      const data = await res.json()
      setResults(data.deals ?? [])
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  async function linkDeal() {
    if (!provider || !selectedId) return
    setLinking(true)
    try {
      const res = await fetch(`/api/contracts/${contractId}/crm-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, externalDealId: selectedId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        if (body?.error === "already_linked") {
          throw new Error("This contract is already linked to a deal in this CRM.")
        }
        throw new Error(body?.error ?? "Failed to link deal")
      }
      toast.success("Deal linked")
      onLinked()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to link deal")
    } finally {
      setLinking(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link to a CRM deal</DialogTitle>
          <DialogDescription>
            Search for a deal in your connected CRM and link it to this contract.
          </DialogDescription>
        </DialogHeader>

        {availableProviders.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No CRM is connected.{" "}
            <Link href="/settings/integrations" className="text-indigo-600 hover:underline">
              Connect one
            </Link>{" "}
            to start linking deals.
          </p>
        ) : (
          <Tabs
            value={provider}
            onValueChange={(v) => setProvider(v as CrmProvider)}
            className="w-full"
          >
            <TabsList>
              {availableProviders.map((p) => (
                <TabsTrigger key={p.id} value={p.id}>
                  {p.name}
                </TabsTrigger>
              ))}
            </TabsList>
            {availableProviders.map((p) => (
              <TabsContent key={p.id} value={p.id} className="mt-3">
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
                    <Input
                      placeholder={`Search ${p.name} deals...`}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                  <div className="max-h-72 overflow-y-auto rounded-md border border-zinc-200">
                    {searching ? (
                      <div className="flex items-center justify-center gap-2 p-6 text-sm text-zinc-500">
                        <Loader2 className="size-4 animate-spin" />
                        Searching…
                      </div>
                    ) : results.length === 0 ? (
                      <div className="p-6 text-center text-sm text-zinc-500">
                        {query
                          ? "No deals match your search."
                          : "Type to search for deals."}
                      </div>
                    ) : (
                      <ul className="divide-y divide-zinc-200">
                        {results.map((deal) => (
                          <li key={deal.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedId(deal.id)}
                              className={
                                "flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition-colors " +
                                (selectedId === deal.id
                                  ? "bg-indigo-50"
                                  : "hover:bg-zinc-50")
                              }
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-zinc-900">
                                  {deal.name}
                                </p>
                                <p className="mt-0.5 text-xs text-zinc-500">
                                  {deal.stage}
                                  {deal.counterpartyName && ` · ${deal.counterpartyName}`}
                                </p>
                              </div>
                              {deal.value != null && (
                                <span className="shrink-0 text-xs text-zinc-600">
                                  {formatMoney(deal.value, deal.currency)}
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={linking}>
            Cancel
          </Button>
          <Button onClick={linkDeal} disabled={!selectedId || linking}>
            {linking ? "Linking..." : "Link deal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatMoney(value: number, currency: string | null) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${value.toLocaleString()}${currency ? ` ${currency}` : ""}`
  }
}

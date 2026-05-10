"use client"

import { useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { format } from "date-fns"
import { Plug2, PlugZap, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  CRM_PROVIDERS,
  type CrmIntegrationStatus,
  type CrmProvider,
  type CrmStatusResponse,
} from "@/lib/types/crm"
import { useSession } from "@/lib/auth/client"

type ProviderSettings = { autoCreateStage: string; syncOnActiveStage: string }

export default function IntegrationsPage() {
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const [loading, setLoading] = useState(true)
  const [integrations, setIntegrations] = useState<CrmIntegrationStatus[]>([])
  const [confirmDisconnect, setConfirmDisconnect] = useState<CrmProvider | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [savingProvider, setSavingProvider] = useState<CrmProvider | null>(null)
  const [settings, setSettings] = useState<Record<string, ProviderSettings>>({})
  const [role, setRole] = useState<string | null>(null)
  const [roleLoaded, setRoleLoaded] = useState(false)

  async function fetchStatus(signal?: AbortSignal) {
    try {
      const res = await fetch("/api/crm/status", { signal })
      if (!res.ok) throw new Error("status")
      const data: CrmStatusResponse = await res.json()
      const list = data.integrations ?? []
      setIntegrations(list)
      const next: Record<string, ProviderSettings> = {}
      for (const it of list) {
        next[it.provider] = {
          autoCreateStage: it.autoCreateStage ?? "",
          syncOnActiveStage: it.syncOnActiveStage ?? "",
        }
      }
      setSettings(next)
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      toast.error("Failed to load integrations")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    fetchStatus(controller.signal)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!session?.user) return
    const controller = new AbortController()
    fetch("/api/org/members", { signal: controller.signal })
      .then((r) => r.json())
      .then((members) => {
        if (Array.isArray(members)) {
          const me = members.find((m) => m.userId === session.user.id)
          setRole(me?.role ?? null)
        }
      })
      .catch(() => {})
      .finally(() => setRoleLoaded(true))
    return () => controller.abort()
  }, [session?.user])

  if (roleLoaded && role !== "admin" && role !== "legal") {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-zinc-900">Integrations</h1>
        <p className="mt-4 text-sm text-zinc-500">
          You don&apos;t have permission to view this page.
        </p>
      </div>
    )
  }

  useEffect(() => {
    const connected = searchParams.get("connected")
    if (connected) {
      toast.success(`${connected.toLowerCase()} connected successfully`)
    }
    const error = searchParams.get("error")
    if (error) {
      toast.error(`Failed to connect: ${error}`)
    }
  }, [searchParams])

  function startConnect(provider: CrmProvider) {
    window.location.href = `/api/crm/${provider.toLowerCase()}/connect`
  }

  async function disconnect(provider: CrmProvider) {
    setDisconnecting(true)
    try {
      const res = await fetch(`/api/crm/${provider.toLowerCase()}/connect`, {
        method: "DELETE",
      })
      if (!res.ok && res.status !== 204) throw new Error("disconnect")
      toast.success(`${provider} disconnected`)
      setConfirmDisconnect(null)
      fetchStatus()
    } catch {
      toast.error("Failed to disconnect")
    } finally {
      setDisconnecting(false)
    }
  }

  async function saveSettings(provider: CrmProvider) {
    const body = settings[provider]
    if (!body) return
    setSavingProvider(provider)
    try {
      const res = await fetch(`/api/crm/${provider.toLowerCase()}/integration`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoCreateStage: body.autoCreateStage || null,
          syncOnActiveStage: body.syncOnActiveStage || null,
        }),
      })
      if (!res.ok) throw new Error("save")
      toast.success("Settings saved")
      fetchStatus()
    } catch {
      toast.error("Failed to save settings")
    } finally {
      setSavingProvider(null)
    }
  }

  function updateSetting(provider: CrmProvider, key: keyof ProviderSettings, value: string) {
    setSettings((prev) => ({
      ...prev,
      [provider]: {
        autoCreateStage: prev[provider]?.autoCreateStage ?? "",
        syncOnActiveStage: prev[provider]?.syncOnActiveStage ?? "",
        [key]: value,
      },
    }))
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">Integrations</h1>
        <p className="text-sm text-zinc-500">
          Connect ClauseFlow to your CRM to link contracts to deals and keep stages in sync.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {CRM_PROVIDERS.map((p) => (
            <div key={p.id} className="rounded-lg border border-zinc-200 bg-white p-6">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="mt-2 h-4 w-72" />
              <Skeleton className="mt-4 h-9 w-28" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {CRM_PROVIDERS.map((meta) => {
            const integration = integrations.find((i) => i.provider === meta.id)
            const connected = !!integration
            const providerSettings = settings[meta.id] ?? {
              autoCreateStage: "",
              syncOnActiveStage: "",
            }
            return (
              <div key={meta.id} className="rounded-lg border border-zinc-200 bg-white p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {connected ? (
                        <Plug2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <PlugZap className="h-4 w-4 text-zinc-400" />
                      )}
                      <h2 className="text-sm font-semibold text-zinc-900">{meta.name}</h2>
                      <span
                        className={
                          connected
                            ? "inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200"
                            : "inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 ring-1 ring-zinc-200"
                        }
                      >
                        {connected ? "Connected" : "Not connected"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-zinc-500">{meta.description}</p>
                    {connected && integration && (
                      <p className="mt-2 text-xs text-zinc-500">
                        Connected by{" "}
                        <span className="text-zinc-700">{integration.connectedBy.name}</span>
                        {integration.connectedAt && (
                          <>
                            {" "}on{" "}
                            <span className="text-zinc-700">
                              {format(new Date(integration.connectedAt), "MMM d, yyyy")}
                            </span>
                          </>
                        )}
                        {integration.portalId && (
                          <>
                            {" "}· portal <span className="font-mono">{integration.portalId}</span>
                          </>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0">
                    {connected ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-red-200 text-red-600 hover:bg-red-50"
                        onClick={() => setConfirmDisconnect(meta.id)}
                      >
                        Disconnect
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => startConnect(meta.id)}>
                        Connect
                      </Button>
                    )}
                  </div>
                </div>

                {connected && (
                  <div className="mt-5 grid grid-cols-1 gap-3 border-t border-zinc-200 pt-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label
                        htmlFor={`${meta.id}-auto`}
                        className="text-xs font-medium text-zinc-700"
                      >
                        Auto-create stage
                      </Label>
                      <Input
                        id={`${meta.id}-auto`}
                        placeholder="e.g. Negotiation"
                        value={providerSettings.autoCreateStage}
                        onChange={(e) =>
                          updateSetting(meta.id, "autoCreateStage", e.target.value)
                        }
                      />
                      <p className="text-xs text-zinc-500">
                        When a deal reaches this stage, a draft contract is created.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label
                        htmlFor={`${meta.id}-sync`}
                        className="text-xs font-medium text-zinc-700"
                      >
                        Sync target stage
                      </Label>
                      <Input
                        id={`${meta.id}-sync`}
                        placeholder={defaultStage(meta.id)}
                        value={providerSettings.syncOnActiveStage}
                        onChange={(e) =>
                          updateSetting(meta.id, "syncOnActiveStage", e.target.value)
                        }
                      />
                      <p className="text-xs text-zinc-500">
                        Stage to set on the deal when the contract becomes active.
                      </p>
                    </div>
                    <div className="sm:col-span-2 flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => saveSettings(meta.id)}
                        disabled={savingProvider === meta.id}
                      >
                        {savingProvider === meta.id ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Saving
                          </>
                        ) : (
                          "Save settings"
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Dialog
        open={!!confirmDisconnect}
        onOpenChange={(open) => {
          if (!open) setConfirmDisconnect(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {confirmDisconnect}?</DialogTitle>
            <DialogDescription>
              Disconnecting will remove all deal links for this integration. Existing contracts are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDisconnect(null)}
              disabled={disconnecting}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              className="border-red-200 text-red-600 hover:bg-red-50"
              onClick={() => confirmDisconnect && disconnect(confirmDisconnect)}
              disabled={disconnecting}
            >
              {disconnecting ? "Disconnecting..." : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function defaultStage(provider: CrmProvider) {
  switch (provider) {
    case "HUBSPOT":
      return "closedwon"
    case "SALESFORCE":
      return "Closed Won"
    case "PIPEDRIVE":
      return "Won"
  }
}

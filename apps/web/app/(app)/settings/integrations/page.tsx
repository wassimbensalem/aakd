"use client"

import { useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { format } from "date-fns"
import {
  Plug2,
  PlugZap,
  Loader2,
  ExternalLink,
  Webhook,
  Key,
} from "lucide-react"
import Link from "next/link"
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
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────

type ProviderSettings = { autoCreateStage: string; syncOnActiveStage: string }

type Category =
  | "CRM"
  | "E-Signature"
  | "Cloud Storage"
  | "Communication"
  | "Accounting"
  | "Developer"

const CATEGORIES: Category[] = [
  "CRM",
  "E-Signature",
  "Cloud Storage",
  "Communication",
  "Accounting",
  "Developer",
]

// ─── Helpers ──────────────────────────────────────────────────────────────

function SoonBadge() {
  return (
    <span className="text-[9px] font-bold bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
      Soon
    </span>
  )
}

function ConnectedBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success ring-1 ring-success/30">
      Connected
    </span>
  )
}

function StatusBadge({ label, variant }: { label: string; variant: "success" | "muted" | "info" }) {
  const cls = {
    success: "bg-success/15 text-success ring-success/30",
    muted: "bg-muted text-muted-foreground ring-border",
    info: "bg-info/15 text-info ring-info/30",
  }[variant]
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1", cls)}>
      {label}
    </span>
  )
}

// ─── Soon Integration Card ────────────────────────────────────────────────

function SoonCard({
  logo,
  name,
  description,
}: {
  logo: React.ReactNode
  name: string
  description: string
}) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card p-4 flex items-start gap-3 opacity-60">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground text-xs font-bold">
        {logo}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h3 className="text-sm font-semibold">{name}</h3>
          <SoonBadge />
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        disabled
        className="shrink-0 h-7 px-2.5 text-xs font-medium rounded-[var(--radius)] border border-border text-muted-foreground cursor-not-allowed opacity-50"
      >
        Connect
      </button>
    </div>
  )
}

// ─── Category Tab Bar ─────────────────────────────────────────────────────

function CategoryTabs({
  active,
  onChange,
}: {
  active: Category
  onChange: (c: Category) => void
}) {
  return (
    <div className="flex items-center gap-1 border-b border-border pb-0 mb-5 overflow-x-auto">
      {CATEGORIES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn(
            "shrink-0 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
            active === c
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {c}
        </button>
      ))}
    </div>
  )
}

// ─── E-Signature Section ──────────────────────────────────────────────────

function ESignatureSection() {
  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius)] border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary text-xs font-bold">
              DS
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <h2 className="text-sm font-semibold">DocuSeal</h2>
                <ConnectedBadge />
              </div>
              <p className="text-xs text-muted-foreground">
                Open-source e-signature for contract signing
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              toast.info(
                "DocuSeal is configured via environment variables. See the self-hosting guide.",
              )
            }
          >
            Configure
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Cloud Storage Section ────────────────────────────────────────────────

function CloudStorageSection() {
  return (
    <div className="space-y-3">
      <SoonCard
        logo="GD"
        name="Google Drive"
        description="Import contracts directly from your Google Drive folders."
      />
      <SoonCard
        logo="DB"
        name="Dropbox"
        description="Sync and import contracts from Dropbox."
      />
      <SoonCard
        logo="OD"
        name="OneDrive"
        description="Connect to Microsoft OneDrive for contract storage."
      />
    </div>
  )
}

// ─── Communication Section ────────────────────────────────────────────────

function CommunicationSection() {
  return (
    <div className="space-y-3">
      <div className="rounded-[var(--radius)] border border-border bg-card p-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground text-xs font-bold">
          SL
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold">Slack</h3>
            <StatusBadge label="Configured via Notifications" variant="success" />
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            Receive contract event notifications in your Slack channels.
          </p>
          <Link
            href="/settings/notifications"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:opacity-80 transition-opacity"
          >
            Configure in Notifications
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>
      <div className="rounded-[var(--radius)] border border-border bg-card p-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground text-xs font-bold">
          MT
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold">Microsoft Teams</h3>
            <StatusBadge label="Configured via Notifications" variant="success" />
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            Receive contract event notifications in Microsoft Teams channels.
          </p>
          <Link
            href="/settings/notifications"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:opacity-80 transition-opacity"
          >
            Configure in Notifications
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  )
}

// ─── Accounting Section ───────────────────────────────────────────────────

function AccountingSection() {
  return (
    <div className="space-y-3">
      <SoonCard
        logo="QB"
        name="QuickBooks"
        description="Sync contract values and billing data with QuickBooks."
      />
      <SoonCard
        logo="XR"
        name="Xero"
        description="Connect contract financials to your Xero accounting."
      />
    </div>
  )
}

// ─── Developer Section ────────────────────────────────────────────────────

function DeveloperSection() {
  return (
    <div className="space-y-3">
      <div className="rounded-[var(--radius)] border border-border bg-card p-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Webhook className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold">Webhooks</h3>
            <ConnectedBadge />
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            Receive real-time HTTP notifications for contract events.
          </p>
          <Link
            href="/settings/notifications#webhooks"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:opacity-80 transition-opacity"
          >
            Manage Webhooks
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>
      <div className="rounded-[var(--radius)] border border-border bg-card p-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Key className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold">REST API</h3>
            <StatusBadge label="Active" variant="success" />
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            Access ClauseFlow programmatically using Bearer API keys.
          </p>
          <Link
            href="/settings/api-keys"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:opacity-80 transition-opacity"
          >
            Manage API Keys
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>
      <SoonCard
        logo="ZP"
        name="Zapier"
        description="Connect ClauseFlow to 5,000+ apps via Zapier automation."
      />
      <SoonCard
        logo="MK"
        name="Make (Integromat)"
        description="Build powerful workflows with ClauseFlow and Make."
      />
    </div>
  )
}

// ─── CRM Section (existing logic kept intact) ─────────────────────────────

function CrmSection({
  loading,
  integrations,
  settings,
  savingProvider,
  onConnect,
  onDisconnectClick,
  onSaveSettings,
  onUpdateSetting,
}: {
  loading: boolean
  integrations: CrmIntegrationStatus[]
  settings: Record<string, ProviderSettings>
  savingProvider: CrmProvider | null
  onConnect: (p: CrmProvider) => void
  onDisconnectClick: (p: CrmProvider) => void
  onSaveSettings: (p: CrmProvider) => void
  onUpdateSetting: (p: CrmProvider, key: keyof ProviderSettings, val: string) => void
}) {
  if (loading) {
    return (
      <div className="space-y-4">
        {CRM_PROVIDERS.map((p) => (
          <div key={p.id} className="rounded-[var(--radius)] border border-border bg-card p-6">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-2 h-4 w-72" />
            <Skeleton className="mt-4 h-9 w-28" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {CRM_PROVIDERS.map((meta) => {
        const integration = integrations.find((i) => i.provider === meta.id)
        const connected = !!integration
        const providerSettings = settings[meta.id] ?? {
          autoCreateStage: "",
          syncOnActiveStage: "",
        }
        return (
          <div key={meta.id} className="rounded-[var(--radius)] border border-border bg-card p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {connected ? (
                    <Plug2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <PlugZap className="h-4 w-4 text-muted-foreground" />
                  )}
                  <h2 className="text-sm font-semibold text-foreground">{meta.name}</h2>
                  <span
                    className={
                      connected
                        ? "inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200"
                        : "inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground/80 ring-1 ring-border"
                    }
                  >
                    {connected ? "Connected" : "Not connected"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>
                {connected && integration && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Connected by{" "}
                    <span className="text-foreground">{integration.connectedBy.name}</span>
                    {integration.connectedAt && (
                      <>
                        {" "}on{" "}
                        <span className="text-foreground">
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
                    onClick={() => onDisconnectClick(meta.id)}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => onConnect(meta.id)}>
                    Connect
                  </Button>
                )}
              </div>
            </div>

            {connected && (
              <div className="mt-5 grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label
                    htmlFor={`${meta.id}-auto`}
                    className="text-xs font-medium text-foreground"
                  >
                    Auto-create stage
                  </Label>
                  <Input
                    id={`${meta.id}-auto`}
                    placeholder="e.g. Negotiation"
                    value={providerSettings.autoCreateStage}
                    onChange={(e) =>
                      onUpdateSetting(meta.id, "autoCreateStage", e.target.value)
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    When a deal reaches this stage, a draft contract is created.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor={`${meta.id}-sync`}
                    className="text-xs font-medium text-foreground"
                  >
                    Sync target stage
                  </Label>
                  <Input
                    id={`${meta.id}-sync`}
                    placeholder={defaultStage(meta.id)}
                    value={providerSettings.syncOnActiveStage}
                    onChange={(e) =>
                      onUpdateSetting(meta.id, "syncOnActiveStage", e.target.value)
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Stage to set on the deal when the contract becomes active.
                  </p>
                </div>
                <div className="sm:col-span-2 flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onSaveSettings(meta.id)}
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
  )
}

function defaultStage(provider: CrmProvider) {
  switch (provider) {
    case "HUBSPOT":   return "closedwon"
    case "SALESFORCE": return "Closed Won"
    case "PIPEDRIVE": return "Won"
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────

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
  const [activeCategory, setActiveCategory] = useState<Category>("CRM")

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

  useEffect(() => {
    const connected = searchParams.get("connected")
    if (connected) toast.success(`${connected.toLowerCase()} connected successfully`)
    const error = searchParams.get("error")
    if (error) toast.error(`Failed to connect: ${error}`)
  }, [searchParams])

  if (roleLoaded && role !== "admin" && role !== "legal") {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-foreground">Integrations</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          You don&apos;t have permission to view this page.
        </p>
      </div>
    )
  }

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
    <div className="flex flex-col h-full">
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-7 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-xl font-semibold">Integrations</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Connect ClauseFlow to the tools your team already uses.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-5 max-w-2xl">
        {/* ── Category tabs ────────────────────────────────────────── */}
        <CategoryTabs active={activeCategory} onChange={setActiveCategory} />

        {/* ── Category content ─────────────────────────────────────── */}
        {activeCategory === "CRM" && (
          <CrmSection
            loading={loading}
            integrations={integrations}
            settings={settings}
            savingProvider={savingProvider}
            onConnect={startConnect}
            onDisconnectClick={setConfirmDisconnect}
            onSaveSettings={saveSettings}
            onUpdateSetting={updateSetting}
          />
        )}
        {activeCategory === "E-Signature" && <ESignatureSection />}
        {activeCategory === "Cloud Storage" && <CloudStorageSection />}
        {activeCategory === "Communication" && <CommunicationSection />}
        {activeCategory === "Accounting" && <AccountingSection />}
        {activeCategory === "Developer" && <DeveloperSection />}
      </div>

      {/* ── Disconnect dialog ────────────────────────────────────────── */}
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
              Disconnecting will remove all deal links for this integration. Existing
              contracts are not affected.
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

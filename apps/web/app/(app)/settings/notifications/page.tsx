"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { format } from "date-fns"
import { Check, Copy, Trash2, Plus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useSession } from "@/lib/auth/client"

interface OrgChannel {
  id: string
  channelType: "slack" | "teams"
  label: string
  enabled: boolean
  createdAt: string
}

interface OutboundWebhookRow {
  id: string
  label: string
  enabled: boolean
  urlPreview: string
  createdAt: string
}

const MAX_PER_TYPE = 5
const MAX_WEBHOOKS = 10

export default function NotificationsSettingsPage() {
  const { data: session } = useSession()
  const [role, setRole] = useState<string | null>(null)
  const [channels, setChannels] = useState<OrgChannel[]>([])
  const [webhooks, setWebhooks] = useState<OutboundWebhookRow[]>([])
  const [loading, setLoading] = useState(true)

  const [showSlackForm, setShowSlackForm] = useState(false)
  const [showTeamsForm, setShowTeamsForm] = useState(false)
  const [slackLabel, setSlackLabel] = useState("")
  const [slackUrl, setSlackUrl] = useState("")
  const [teamsLabel, setTeamsLabel] = useState("")
  const [teamsUrl, setTeamsUrl] = useState("")
  const [saving, setSaving] = useState(false)

  const [showWebhookForm, setShowWebhookForm] = useState(false)
  const [webhookLabel, setWebhookLabel] = useState("")
  const [webhookUrl, setWebhookUrl] = useState("")

  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const isAdmin = role === "admin" || role === "owner"

  const slackChannels = useMemo(
    () => channels.filter((c) => c.channelType === "slack"),
    [channels],
  )
  const teamsChannels = useMemo(
    () => channels.filter((c) => c.channelType === "teams"),
    [channels],
  )

  async function loadAll() {
    try {
      const [chRes, whRes, mRes] = await Promise.all([
        fetch("/api/org/notification-channels"),
        fetch("/api/org/webhooks"),
        fetch("/api/org/members"),
      ])
      if (chRes.ok) {
        const d = await chRes.json()
        setChannels(d.channels ?? [])
      }
      if (whRes.ok) {
        const d = await whRes.json()
        setWebhooks(d.webhooks ?? [])
      }
      if (mRes.ok && session?.user?.id) {
        const d = await mRes.json()
        const list = d.members ?? d ?? []
        const mine = list.find(
          (m: { userId?: string; user?: { id?: string }; role?: string }) =>
            m.userId === session.user.id || m.user?.id === session.user.id,
        )
        setRole(mine?.role ?? null)
      }
    } catch {
      toast.error("Failed to load notification settings")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id])

  async function createChannel(channelType: "slack" | "teams") {
    const label = channelType === "slack" ? slackLabel : teamsLabel
    const url = channelType === "slack" ? slackUrl : teamsUrl
    if (!label.trim() || !url.trim()) return
    setSaving(true)
    try {
      const res = await fetch("/api/org/notification-channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelType, label, webhookUrl: url }),
      })
      if (!res.ok) {
        if (res.status === 422) {
          const err = await res.json().catch(() => null)
          if (err?.error === "limit_reached") {
            toast.error(`Maximum ${MAX_PER_TYPE} ${channelType} channels reached`)
            return
          }
        }
        throw new Error()
      }
      toast.success(`${channelType === "slack" ? "Slack" : "Teams"} channel added`)
      if (channelType === "slack") {
        setSlackLabel("")
        setSlackUrl("")
        setShowSlackForm(false)
      } else {
        setTeamsLabel("")
        setTeamsUrl("")
        setShowTeamsForm(false)
      }
      loadAll()
    } catch {
      toast.error("Failed to add channel")
    } finally {
      setSaving(false)
    }
  }

  async function toggleChannel(id: string, enabled: boolean) {
    try {
      const res = await fetch(`/api/org/notification-channels/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) throw new Error()
      setChannels((prev) =>
        prev.map((c) => (c.id === id ? { ...c, enabled } : c)),
      )
    } catch {
      toast.error("Failed to update channel")
    }
  }

  async function deleteChannel(id: string) {
    if (!confirm("Delete this channel? This cannot be undone.")) return
    try {
      const res = await fetch(`/api/org/notification-channels/${id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error()
      toast.success("Channel deleted")
      loadAll()
    } catch {
      toast.error("Failed to delete channel")
    }
  }

  async function createWebhook(e: React.FormEvent) {
    e.preventDefault()
    if (!webhookLabel.trim() || !webhookUrl.trim()) return
    setSaving(true)
    try {
      const res = await fetch("/api/org/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: webhookLabel, url: webhookUrl }),
      })
      if (!res.ok) {
        if (res.status === 422) {
          const err = await res.json().catch(() => null)
          if (err?.error === "limit_reached") {
            toast.error(`Maximum ${MAX_WEBHOOKS} webhooks reached`)
            return
          }
        }
        throw new Error()
      }
      const data = (await res.json()) as { signingSecret: string }
      setNewSecret(data.signingSecret)
      setWebhookLabel("")
      setWebhookUrl("")
      setShowWebhookForm(false)
      loadAll()
    } catch {
      toast.error("Failed to create webhook")
    } finally {
      setSaving(false)
    }
  }

  async function deleteWebhook(id: string) {
    if (!confirm("Delete this webhook? Delivery history will also be removed.")) {
      return
    }
    try {
      const res = await fetch(`/api/org/webhooks/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      toast.success("Webhook deleted")
      loadAll()
    } catch {
      toast.error("Failed to delete webhook")
    }
  }

  async function copySecret() {
    if (!newSecret) return
    await navigator.clipboard.writeText(newSecret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="p-6 space-y-8 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Configure how your organization receives contract lifecycle events
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Slack &amp; Teams</h2>
            <p className="text-xs text-muted-foreground">
              Receive contract events in your team chat channels
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            Slack: {slackChannels.length} of {MAX_PER_TYPE} · Teams:{" "}
            {teamsChannels.length} of {MAX_PER_TYPE}
          </div>
        </div>

        <div className="rounded-[var(--radius)] border border-border bg-card">
          {loading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : channels.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No channels configured yet
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Channel</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-20">Enabled</TableHead>
                  {isAdmin && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {c.channelType}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{c.label}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(c.createdAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={c.enabled}
                        onCheckedChange={
                          isAdmin
                            ? (v) => toggleChannel(c.id, v)
                            : undefined
                        }
                        disabled={!isAdmin}
                      />
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteChannel(c.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowSlackForm((v) => !v)}
              disabled={slackChannels.length >= MAX_PER_TYPE}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Slack channel
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowTeamsForm((v) => !v)}
              disabled={teamsChannels.length >= MAX_PER_TYPE}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Teams channel
            </Button>
          </div>
        )}

        {showSlackForm && isAdmin && (
          <ChannelForm
            kind="slack"
            label={slackLabel}
            url={slackUrl}
            saving={saving}
            onLabel={setSlackLabel}
            onUrl={setSlackUrl}
            onSubmit={() => createChannel("slack")}
            onCancel={() => {
              setShowSlackForm(false)
              setSlackLabel("")
              setSlackUrl("")
            }}
          />
        )}
        {showTeamsForm && isAdmin && (
          <ChannelForm
            kind="teams"
            label={teamsLabel}
            url={teamsUrl}
            saving={saving}
            onLabel={setTeamsLabel}
            onUrl={setTeamsUrl}
            onSubmit={() => createChannel("teams")}
            onCancel={() => {
              setShowTeamsForm(false)
              setTeamsLabel("")
              setTeamsUrl("")
            }}
          />
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Outbound Webhooks
            </h2>
            <p className="text-xs text-muted-foreground">
              Send signed events to your own systems (Zapier, Make, internal APIs)
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            {webhooks.length} of {MAX_WEBHOOKS} configured
          </div>
        </div>

        <div className="rounded-[var(--radius)] border border-border bg-card">
          {loading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : webhooks.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No webhooks configured yet
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Label</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-32" />
                  {isAdmin && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">{w.label}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {w.urlPreview}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(w.createdAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/settings/notifications/webhooks/${w.id}/deliveries`}
                        className="text-xs text-primary hover:underline"
                      >
                        View deliveries
                      </Link>
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteWebhook(w.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {isAdmin && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowWebhookForm((v) => !v)}
            disabled={webhooks.length >= MAX_WEBHOOKS}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add webhook
          </Button>
        )}

        {showWebhookForm && isAdmin && (
          <form
            onSubmit={createWebhook}
            className="rounded-[var(--radius)] border border-border bg-card p-4 space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="wh-label">Label</Label>
              <Input
                id="wh-label"
                placeholder="Production Zapier"
                value={webhookLabel}
                onChange={(e) => setWebhookLabel(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wh-url">URL</Label>
              <Input
                id="wh-url"
                type="url"
                placeholder="https://hooks.example.com/clauseflow"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                required
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? "Creating..." : "Create"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowWebhookForm(false)
                  setWebhookLabel("")
                  setWebhookUrl("")
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </section>

      <Dialog open={!!newSecret} onOpenChange={() => setNewSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Webhook signing secret</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
              <p className="text-sm text-amber-800 font-medium">
                This secret is shown once. Save it now — it cannot be retrieved
                again.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={newSecret ?? ""}
                readOnly
                className="font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={copySecret}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <Button className="w-full" onClick={() => setNewSecret(null)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface ChannelFormProps {
  kind: "slack" | "teams"
  label: string
  url: string
  saving: boolean
  onLabel: (v: string) => void
  onUrl: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
}

function ChannelForm({
  kind,
  label,
  url,
  saving,
  onLabel,
  onUrl,
  onSubmit,
  onCancel,
}: ChannelFormProps) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      className="rounded-[var(--radius)] border border-border bg-card p-4 space-y-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor={`${kind}-label`}>Label</Label>
        <Input
          id={`${kind}-label`}
          placeholder={kind === "slack" ? "#legal-alerts" : "Legal Channel"}
          value={label}
          onChange={(e) => onLabel(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${kind}-url`}>Incoming webhook URL</Label>
        <Input
          id={`${kind}-url`}
          type="password"
          autoComplete="new-password"
          placeholder={
            kind === "slack"
              ? "https://hooks.slack.com/services/..."
              : "https://outlook.office.com/webhook/..."
          }
          value={url}
          onChange={(e) => onUrl(e.target.value)}
          required
        />
      </div>
      <div className="flex gap-2 pt-1">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Adding..." : "Add"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

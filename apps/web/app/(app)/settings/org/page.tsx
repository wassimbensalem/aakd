"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { ImageIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useActiveOrganization, organization } from "@/lib/auth/client"

type AIStatus = { provider: string | null; model: string | null }

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  ollama: "Ollama (self-hosted)",
}

const TIMEZONES = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "EST — Eastern" },
  { value: "America/Los_Angeles", label: "PST — Pacific" },
  { value: "Europe/Paris", label: "CET — Central European" },
  { value: "Asia/Kolkata", label: "IST — India" },
  { value: "Asia/Tokyo", label: "JST — Japan" },
  { value: "Australia/Sydney", label: "AEST — Australia Eastern" },
]

const INDUSTRIES = [
  "Technology",
  "Healthcare",
  "Finance",
  "Legal",
  "Manufacturing",
  "Retail",
  "Other",
]

export default function OrgSettingsPage() {
  const { data: activeOrg } = useActiveOrganization()
  const [name, setName] = useState("")
  const [domain, setDomain] = useState("")
  const [timezone, setTimezone] = useState("UTC")
  const [industry, setIndustry] = useState("")
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (activeOrg?.name) setName(activeOrg.name)
  }, [activeOrg])

  useEffect(() => {
    fetch("/api/org")
      .then((r) => r.json())
      .then((data: { name?: string; meta?: Record<string, unknown>; logo?: string | null }) => {
        if (data.name) setName(data.name)
        if (data.meta?.domain) setDomain(data.meta.domain as string)
        if (data.meta?.timezone) setTimezone(data.meta.timezone as string)
        if (data.meta?.industry) setIndustry(data.meta.industry as string)
        if (data.logo) setLogoUrl(data.logo)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch("/api/ai-status")
      .then((r) => r.json())
      .then((data: AIStatus) => setAiStatus(data))
      .catch(() => setAiStatus({ provider: null, model: null }))
  }, [])

  async function handleLogoFile(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be under 2 MB")
      return
    }
    setLogoUploading(true)
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch("/api/org/logo", { method: "POST", body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error((err as { error?: string }).error ?? "Failed to upload logo")
        return
      }
      const data = (await res.json()) as { url: string }
      setLogoUrl(data.url)
    } catch {
      toast.error("Failed to upload logo")
    } finally {
      setLogoUploading(false)
    }
  }

  function handleLogoDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleLogoFile(file)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch("/api/org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, domain, timezone, industry, logo: logoUrl }),
      })
      if (!res.ok) throw new Error("Failed to update")
      toast.success("Organization updated")
      if (activeOrg?.id) {
        await organization.setActive({ organizationId: activeOrg.id }).catch(() => {})
      }
    } catch {
      toast.error("Failed to update organization")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Organization</h1>
        <p className="text-sm text-muted-foreground">Manage your organization settings</p>
      </div>

      {/* General Information card */}
      <div className="rounded-[var(--radius)] border border-border bg-card p-6">
        <h2 className="text-sm font-semibold text-foreground mb-4">General Information</h2>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="orgName" className="text-sm font-medium text-foreground">
                Organization Name
              </Label>
              <Input
                id="orgName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orgDomain" className="text-sm font-medium text-foreground">
                Domain
              </Label>
              <Input
                id="orgDomain"
                placeholder="yourcompany.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orgTimezone" className="text-sm font-medium text-foreground">
                Timezone
              </Label>
              <select
                id="orgTimezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="flex h-9 w-full rounded-[var(--radius)] border border-border bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orgIndustry" className="text-sm font-medium text-foreground">
                Industry
              </Label>
              <select
                id="orgIndustry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="flex h-9 w-full rounded-[var(--radius)] border border-border bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Select industry</option>
                {INDUSTRIES.map((ind) => (
                  <option key={ind} value={ind}>{ind}</option>
                ))}
              </select>
            </div>
          </div>

          {activeOrg?.createdAt && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-foreground">Created</Label>
              <p className="text-sm text-muted-foreground">
                {format(new Date(activeOrg.createdAt), "MMMM d, yyyy")}
              </p>
            </div>
          )}

          <div className="border-t border-border pt-4 flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </div>

      {/* Organization Logo card */}
      <div className="rounded-[var(--radius)] border border-border bg-card p-6">
        <h2 className="text-sm font-semibold text-foreground mb-4">Organization Logo</h2>
        {logoUrl ? (
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoUrl}
              alt="Organization logo"
              className="h-16 w-16 rounded-[var(--radius)] object-cover border border-border"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLogoUrl(null)}
            >
              Remove
            </Button>
          </div>
        ) : (
          <div
            className={`border-2 border-dashed border-border rounded-[var(--radius)] p-8 flex flex-col items-center justify-center gap-2 transition-colors ${logoUploading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-muted/40"}`}
            onClick={() => !logoUploading && fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { if (!logoUploading) handleLogoDrop(e) }}
          >
            <ImageIcon className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-foreground font-medium">
              {logoUploading ? "Uploading…" : "Click to upload or drag and drop"}
            </p>
            <p className="text-xs text-muted-foreground">PNG, JPG, WebP up to 2MB</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleLogoFile(file)
              }}
            />
          </div>
        )}
      </div>

      {/* AI Configuration */}
      <div className="rounded-[var(--radius)] border border-border bg-card p-6">
        <h2 className="text-sm font-semibold text-foreground mb-4">AI Configuration</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground/80">Provider</span>
            {aiStatus === null ? (
              <span className="text-sm text-muted-foreground">Loading…</span>
            ) : aiStatus.provider ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                {PROVIDER_LABELS[aiStatus.provider] ?? aiStatus.provider}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <span className="inline-block w-2 h-2 rounded-full bg-border" />
                Not configured
              </span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground/80">Model</span>
            {aiStatus?.model ? (
              <span className="text-sm font-mono text-foreground">{aiStatus.model}</span>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </div>
        </div>
        {!aiStatus?.provider && aiStatus !== null && (
          <p className="mt-3 text-xs text-muted-foreground">
            Set <code className="bg-muted px-1 rounded">AI_PROVIDER</code> and the corresponding API key in your environment to enable AI extraction and Q&amp;A.
          </p>
        )}
      </div>
    </div>
  )
}

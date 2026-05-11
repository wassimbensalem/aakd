"use client"

import { useState, useEffect } from "react"
import { toast } from "sonner"
import { format, formatDistanceToNow } from "date-fns"
import { Plus, Copy, Check, Info, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ApiKey } from "@/lib/types"
import { useTranslations } from "next-intl"

export default function ApiKeysPage() {
  const t = useTranslations("apiKeys")
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [keyName, setKeyName] = useState("")
  const [keyDescription, setKeyDescription] = useState("")
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copiedNew, setCopiedNew] = useState(false)

  async function fetchKeys() {
    try {
      const res = await fetch("/api/org/api-keys")
      if (!res.ok) throw new Error()
      const data = await res.json()
      setKeys(data.apiKeys ?? data ?? [])
    } catch {
      toast.error(t("failedToLoad"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchKeys() }, [])

  async function createKey(e: React.FormEvent) {
    e.preventDefault()
    if (!keyName.trim()) return
    setCreating(true)
    try {
      const res = await fetch("/api/org/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName, description: keyDescription }),
      })
      if (!res.ok) throw new Error("Failed to create")
      const data = await res.json()
      setNewKey(data.rawKey ?? data.key)
      setKeyName("")
      setKeyDescription("")
      setShowCreateModal(false)
      fetchKeys()
    } catch {
      toast.error(t("createFailed"))
    } finally {
      setCreating(false)
    }
  }

  async function revokeKey(id: string) {
    if (!confirm(t("revokeConfirm"))) return
    try {
      const res = await fetch(`/api/org/api-keys/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      toast.success(t("revokeSuccess"))
      fetchKeys()
    } catch {
      toast.error(t("revokeFailed"))
    }
  }

  async function copyNewKey(key: string) {
    await navigator.clipboard.writeText(key)
    setCopiedNew(true)
    setTimeout(() => setCopiedNew(false), 2000)
  }

  function maskKey(prefix: string) {
    return `cf_live_${"•".repeat(16)}${prefix.slice(-4)}`
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="h-4 w-4 mr-2" />
          {t("createNewKey")}
        </Button>
      </div>

      {/* Warning banner */}
      <div className="rounded-[var(--radius)] border border-amber-200 bg-amber-50 p-4 flex gap-3">
        <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800">
          API keys provide full access to your organization&apos;s data. Keep them secret and rotate them regularly.
        </p>
      </div>

      {/* Key cards */}
      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-[var(--radius)] border border-border bg-card p-5">
              <Skeleton className="h-4 w-32 mb-3" />
              <Skeleton className="h-4 w-64" />
            </div>
          ))
        ) : keys.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            {t("noKeys")}
          </div>
        ) : (
          keys.map((k) => (
            <div
              key={k.id}
              className={`rounded-[var(--radius)] border border-border bg-card p-5 ${k.revokedAt ? "opacity-50" : ""}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2 min-w-0">
                  <p className="font-semibold text-sm text-foreground">{k.name}</p>
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded-[var(--radius)]">
                      {maskKey(k.prefix)}
                    </code>
                  </div>
                  {!k.revokedAt && (
                    <p className="text-xs text-muted-foreground">
                      {t("keyShownOnce")}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{t("created")} {format(new Date(k.createdAt), "MMM d, yyyy")}</span>
                    {k.lastUsedAt && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{t("lastUsed")} {formatDistanceToNow(new Date(k.lastUsedAt), { addSuffix: true })}</span>
                      </>
                    )}
                    {!k.lastUsedAt && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{t("neverUsed")}</span>
                      </>
                    )}
                  </div>
                </div>
                {!k.revokedAt && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 text-destructive border-destructive/40 hover:bg-destructive/5"
                    onClick={() => revokeKey(k.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    {t("revoke")}
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create key modal */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createModalTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={createKey} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="keyName" className="text-sm font-medium text-foreground">
                {t("keyName")}
              </Label>
              <Input
                id="keyName"
                placeholder="Production agent"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="keyDescription" className="text-sm font-medium text-foreground">
                {t("descriptionOptional")}
              </Label>
              <Input
                id="keyDescription"
                placeholder="Used by the nightly renewal agent"
                value={keyDescription}
                onChange={(e) => setKeyDescription(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? t("creating") : t("createKey")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* New key reveal modal */}
      <Dialog open={!!newKey} onOpenChange={() => setNewKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createdTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="rounded-[var(--radius)] bg-amber-50 border border-amber-200 p-3">
              <p className="text-sm text-amber-800 font-medium">
                {t("copyOnce")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input value={newKey ?? ""} readOnly className="font-mono text-sm" />
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => newKey && copyNewKey(newKey)}
              >
                {copiedNew
                  ? <Check className="h-4 w-4 text-emerald-600" />
                  : <Copy className="h-4 w-4" />
                }
              </Button>
            </div>
            <Button className="w-full" onClick={() => setNewKey(null)}>{t("done")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

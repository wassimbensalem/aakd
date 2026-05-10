"use client"

import { useState, useEffect } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { Trash2, Copy, Check, Key } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ApiKey } from "@/lib/types"

const SCOPES = ["read", "write"] as const

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [keyName, setKeyName] = useState("")
  const [scopes, setScopes] = useState<string[]>(["read"])
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function fetchKeys() {
    try {
      const res = await fetch("/api/org/api-keys")
      if (!res.ok) throw new Error()
      const data = await res.json()
      setKeys(data.apiKeys ?? data ?? [])
    } catch {
      toast.error("Failed to load API keys")
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
        body: JSON.stringify({ name: keyName, scopes }),
      })
      if (!res.ok) throw new Error("Failed to create")
      const data = await res.json()
      setNewKey(data.rawKey ?? data.key)
      setKeyName("")
      setScopes(["read"])
      fetchKeys()
    } catch {
      toast.error("Failed to create API key")
    } finally {
      setCreating(false)
    }
  }

  async function revokeKey(id: string) {
    if (!confirm("Revoke this API key? This cannot be undone.")) return
    try {
      const res = await fetch(`/api/org/api-keys/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      toast.success("API key revoked")
      fetchKeys()
    } catch {
      toast.error("Failed to revoke key")
    }
  }

  async function copyKey(key: string) {
    await navigator.clipboard.writeText(key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function toggleScope(scope: string) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground">API Keys</h1>
        <p className="text-sm text-muted-foreground">Manage API keys for external integrations</p>
      </div>

      {/* Callout */}
      <div className="rounded-[var(--radius)] border border-border bg-primary/10 p-4 flex gap-3">
        <Key className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-foreground">MCP Server Access</p>
          <p className="text-sm text-muted-foreground">
            API keys let AI agents (Claude, n8n, etc.) access your contracts via the MCP server.
          </p>
        </div>
      </div>

      {/* Create form */}
      <div className="rounded-[var(--radius)] border border-border bg-card p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Create API Key</h2>
        <form onSubmit={createKey} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="keyName" className="text-sm font-medium text-foreground">Name</Label>
            <Input id="keyName" placeholder="Production agent" value={keyName} onChange={(e) => setKeyName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">Scopes</Label>
            <div className="flex gap-3">
              {SCOPES.map((scope) => (
                <label key={scope} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                    className="h-4 w-4 rounded accent-primary"
                  />
                  <span className="text-sm text-foreground">{scope}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="border-t border-border pt-3">
            <Button type="submit" size="sm" disabled={creating || scopes.length === 0}>
              {creating ? "Creating..." : "Create Key"}
            </Button>
          </div>
        </form>
      </div>

      {/* Keys table */}
      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>Scopes</TableHead>
              <TableHead>Last Used</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 2 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : keys.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  No API keys yet
                </TableCell>
              </TableRow>
            ) : (
              keys.map((k) => (
                <TableRow key={k.id} className={k.revokedAt ? "opacity-50" : ""}>
                  <TableCell className="font-medium text-foreground">{k.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{k.prefix}...</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {k.scopes.map((s) => (
                        <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {k.lastUsedAt ? format(new Date(k.lastUsedAt), "MMM d, yyyy") : "Never"}
                  </TableCell>
                  <TableCell>
                    {!k.revokedAt && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => revokeKey(k.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* New key reveal modal */}
      <Dialog open={!!newKey} onOpenChange={() => setNewKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
              <p className="text-sm text-amber-800 font-medium">
                This key will only be shown once. Copy it now.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input value={newKey ?? ""} readOnly className="font-mono text-sm" />
              <Button variant="outline" size="icon" className="shrink-0" onClick={() => newKey && copyKey(newKey)}>
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <Button className="w-full" onClick={() => setNewKey(null)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

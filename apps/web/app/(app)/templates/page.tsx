"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { TypeBadge } from "@/components/contract-badges"
import { RelativeTime } from "@/components/relative-time"
import { useSession } from "@/lib/auth/client"
import { FillVariablesDialog } from "@/components/templates/fill-variables-dialog"

interface TemplateSummary {
  id: string
  name: string
  description?: string | null
  contractType?: string | null
  wordCount: number
  createdAt: string
  updatedAt: string
  createdBy: { id: string; name: string }
}

const CONTRACT_TYPES = ["NDA", "MSA", "SOW", "EMPLOYMENT", "VENDOR", "CUSTOMER", "OTHER"] as const

export default function TemplatesPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>("ALL")
  const [role, setRole] = useState<string>("member")
  const [usingTemplateId, setUsingTemplateId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const limit = 20
  const totalPages = Math.max(1, Math.ceil(total / limit))

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filter !== "ALL") params.set("contractType", filter)
      params.set("page", String(page))
      params.set("limit", String(limit))
      const res = await fetch(`/api/templates?${params}`, { signal })
      if (!res.ok) {
        toast.error("Failed to load templates")
        return
      }
      const data = await res.json()
      setTemplates(data.templates ?? [])
      setTotal(data.total ?? 0)
    } catch (e) {
      if ((e as Error).name === "AbortError") return
      toast.error("Failed to load templates")
    } finally {
      setLoading(false)
    }
  }, [filter, page])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  useEffect(() => {
    if (!session?.user) return
    const controller = new AbortController()
    fetch("/api/org/members", { signal: controller.signal })
      .then((r) => r.json())
      .then((members) => {
        if (Array.isArray(members)) {
          const me = members.find((m) => m.userId === session.user.id)
          if (me?.role) setRole(me.role)
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [session?.user])

  const canManage = role === "admin" || role === "legal" || role === "owner"

  async function archive(templateId: string) {
    if (!confirm("Archive this template? Existing contracts created from it are not affected.")) return
    try {
      const res = await fetch(`/api/templates/${templateId}`, { method: "DELETE" })
      if (res.status === 204) {
        toast.success("Template archived")
        load()
      } else {
        toast.error("Failed to archive")
      }
    } catch {
      toast.error("Failed to archive")
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Templates</h1>
          <p className="text-sm text-muted-foreground">Create reusable contract templates with variable placeholders.</p>
        </div>
        {canManage && (
          <Button onClick={() => router.push("/templates/new")}>
            <Plus className="size-4" />
            New Template
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Select value={filter} onValueChange={(v) => {
          if (v) {
            setFilter(v)
            setPage(1)
          }
        }}>
          <SelectTrigger className="h-9 w-44 text-sm">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            {CONTRACT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No templates yet. Create your first template to start drafting contracts faster.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((t) => (
              <div key={t.id} className="rounded-[var(--radius)] border border-border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">{t.name}</p>
                    {t.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{t.description}</p>
                    )}
                  </div>
                  {t.contractType && (
                    <TypeBadge type={t.contractType as never} />
                  )}
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <p>{t.wordCount.toLocaleString()} words</p>
                  <p>By {t.createdBy.name}</p>
                  <p>Updated <RelativeTime date={t.updatedAt} /></p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => setUsingTemplateId(t.id)}>Use template</Button>
                  {canManage && (
                    <>
                      <Link href={`/templates/${t.id}/edit`}>
                        <Button variant="outline" size="sm">Edit</Button>
                      </Link>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-red-200 text-red-600 hover:bg-red-50 ml-auto"
                        onClick={() => archive(t.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}

      {usingTemplateId && (
        <FillVariablesDialog
          templateId={usingTemplateId}
          onClose={() => setUsingTemplateId(null)}
          onCreated={(contractId) => {
            setUsingTemplateId(null)
            router.push(`/contracts/${contractId}?tab=editor`)
          }}
        />
      )}
    </div>
  )
}

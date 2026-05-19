"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Copy, Eye, FileText, LayoutTemplate, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
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
  variableCount?: number
  usageCount?: number
  lastUsedAt?: string | null
  createdAt: string
  updatedAt: string
  createdBy: { id: string; name: string }
}

const CONTRACT_TYPES = ["NDA", "MSA", "SOW", "EMPLOYMENT", "VENDOR", "CUSTOMER", "OTHER"] as const

type SortOption = "recent" | "oldest" | "az" | "za"

export default function TemplatesPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>("ALL")
  const [sort, setSort] = useState<SortOption>("recent")
  const [search, setSearch] = useState("")
  const [role, setRole] = useState<string>("member")
  const [usingTemplateId, setUsingTemplateId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  // Archive confirm dialog state
  const [archiveTarget, setArchiveTarget] = useState<TemplateSummary | null>(null)
  const [archiving, setArchiving] = useState(false)

  // Preview sheet state
  const [previewTemplate, setPreviewTemplate] = useState<TemplateSummary | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const [previewVariables, setPreviewVariables] = useState<{ name: string; label: string }[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)

  // Duplicate loading state
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)

  // Starter templates loading state
  const [loadingStarters, setLoadingStarters] = useState(false)

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

  // Fetch full template content when preview opens
  useEffect(() => {
    if (!previewTemplate) {
      setPreviewContent(null)
      setPreviewVariables([])
      return
    }
    setPreviewLoading(true)
    fetch(`/api/templates/${previewTemplate.id}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data) => {
        // Extract plain text from TipTap JSON
        type AnyNode = { type?: string; text?: string; content?: AnyNode[]; attrs?: Record<string, unknown> }
        function extractText(node: AnyNode): string {
          if (node.type === "templateVariable") {
            const v = node.attrs?.variable as string | undefined
            return v ? `{{${v}}}` : ""
          }
          if (node.text) return node.text
          if (node.content) {
            const isBlock = ["paragraph","heading","bulletList","orderedList","listItem","blockquote"].includes(node.type ?? "")
            return node.content.map(extractText).join("") + (isBlock ? "\n" : "")
          }
          return ""
        }
        const content = data.template?.content
        const text = content ? extractText(content as AnyNode).trim() : null
        setPreviewContent(text)
        const vars = Array.isArray(data.template?.variables) ? data.template.variables : []
        setPreviewVariables(vars as { name: string; label: string }[])
      })
      .catch(() => { setPreviewContent(null) })
      .finally(() => setPreviewLoading(false))
  }, [previewTemplate])

  async function confirmArchive() {
    if (!archiveTarget) return
    setArchiving(true)
    try {
      const res = await fetch(`/api/templates/${archiveTarget.id}`, { method: "DELETE" })
      if (res.status === 204) {
        toast.success("Template archived")
        setArchiveTarget(null)
        load()
      } else {
        toast.error("Failed to archive")
      }
    } catch {
      toast.error("Failed to archive")
    } finally {
      setArchiving(false)
    }
  }

  async function duplicate(t: TemplateSummary) {
    setDuplicatingId(t.id)
    try {
      // Fetch full template content first
      const res = await fetch(`/api/templates/${t.id}`)
      if (!res.ok) throw new Error("fetch failed")
      const full = await res.json()

      const createRes = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Copy of ${t.name}`,
          description: full.description,
          contractType: full.contractType,
          content: full.content,
          variables: full.variables ?? [],
          wordCount: full.wordCount ?? 0,
        }),
      })
      if (!createRes.ok) throw new Error("create failed")
      toast.success(`Duplicated "${t.name}"`)
      load()
    } catch {
      toast.error("Failed to duplicate template")
    } finally {
      setDuplicatingId(null)
    }
  }

  async function loadStarterTemplates() {
    setLoadingStarters(true)
    try {
      const res = await fetch("/api/templates/seed", { method: "POST" })
      if (!res.ok) {
        toast.error("Failed to load starter templates")
        return
      }
      const data = await res.json()
      const created: number = data.created ?? 0
      toast.success(created > 0 ? `${created} starter templates loaded!` : "Starter templates already exist")
      load()
    } catch {
      toast.error("Failed to load starter templates")
    } finally {
      setLoadingStarters(false)
    }
  }

  // Client-side filtering and sorting
  const displayed = templates
    .filter((t) => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return (
        t.name.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      if (sort === "az") return a.name.localeCompare(b.name)
      if (sort === "za") return b.name.localeCompare(a.name)
      if (sort === "oldest") return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
      // "recent" = by updatedAt desc (default)
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Templates</h1>
          <p className="text-sm text-muted-foreground">Create reusable contract templates with variable placeholders.</p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadStarterTemplates}
              disabled={loadingStarters}
            >
              {loadingStarters ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LayoutTemplate className="size-4" />
              )}
              Load starters
            </Button>
            <Button onClick={() => router.push("/templates/new")}>
              <Plus className="size-4" />
              New Template
            </Button>
          </div>
        )}
      </div>

      {/* Search + Sort + Filter row */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search templates…"
          className="h-9 w-56 text-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
        <Select value={sort} onValueChange={(v) => v && setSort(v as SortOption)}>
          <SelectTrigger className="h-9 w-44 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Newest</SelectItem>
            <SelectItem value="oldest">Oldest</SelectItem>
            <SelectItem value="az">Name A–Z</SelectItem>
            <SelectItem value="za">Name Z–A</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : displayed.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-border bg-card p-10 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            {templates.length === 0
              ? "No templates yet. Create your first template to start drafting contracts faster."
              : "No templates match your search."}
          </p>
          {templates.length === 0 && canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={loadStarterTemplates}
              disabled={loadingStarters}
            >
              {loadingStarters ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LayoutTemplate className="size-4" />
              )}
              Load starter templates
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayed.map((t) => (
              <div
                key={t.id}
                className="group rounded-[var(--radius)] border border-border bg-card flex flex-col overflow-hidden hover:border-border/80 hover:shadow-sm transition-all"
              >
                {/* Card top: category badge + menu */}
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                  <div className="min-h-[20px]">
                    {t.contractType ? (
                      <TypeBadge type={t.contractType as never} />
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        General
                      </span>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground transition-all focus:opacity-100 focus:outline-none disabled:pointer-events-none disabled:opacity-50">
                      <MoreHorizontal className="size-4" />
                      <span className="sr-only">More options</span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" side="bottom">
                      {canManage && (
                        <DropdownMenuItem
                          onSelect={() => router.push(`/templates/${t.id}/edit`)}
                        >
                          <Pencil className="size-3.5" />
                          Edit
                        </DropdownMenuItem>
                      )}
                      {canManage && (
                        <DropdownMenuItem
                          onSelect={() => duplicate(t)}
                          disabled={duplicatingId === t.id}
                        >
                          <Copy className="size-3.5" />
                          {duplicatingId === t.id ? "Duplicating…" : "Duplicate"}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onSelect={() => setPreviewTemplate(t)}
                      >
                        <Eye className="size-3.5" />
                        Preview
                      </DropdownMenuItem>
                      {canManage && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setArchiveTarget(t)}
                          >
                            <Trash2 className="size-3.5" />
                            Archive
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Card body: icon + title + description */}
                <div className="flex-1 px-4 pb-3 space-y-1">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 shrink-0 rounded-md bg-muted p-1.5">
                      <FileText className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground leading-tight truncate">{t.name}</p>
                      {t.description ? (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5 leading-relaxed">
                          {t.description}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground/50 mt-0.5 italic">No description</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Stats row */}
                <div className="flex items-center gap-3 px-4 py-2.5 border-t border-border/50 text-xs text-muted-foreground">
                  {typeof t.variableCount === "number" && (
                    <span className="inline-flex items-center gap-1">
                      <span className="size-1.5 rounded-full bg-amber-400 shrink-0" />
                      {t.variableCount} var{t.variableCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-muted-foreground/30 shrink-0" />
                    {t.lastUsedAt ? (
                      <>Last used <RelativeTime date={t.lastUsedAt} /></>
                    ) : (
                      <>Updated <RelativeTime date={t.updatedAt} /></>
                    )}
                  </span>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 px-4 pb-4 pt-1">
                  <Button size="sm" className="flex-1" onClick={() => setUsingTemplateId(t.id)}>
                    Use Template
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPreviewTemplate(t)}
                    title="Preview template"
                  >
                    <Eye className="size-3.5" />
                    Preview
                  </Button>
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

      {/* Archive confirmation dialog */}
      <Dialog open={!!archiveTarget} onOpenChange={(open) => !open && !archiving && setArchiveTarget(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Archive template?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            &ldquo;{archiveTarget?.name}&rdquo; will be archived. Existing contracts created from it are not affected.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setArchiveTarget(null)}
              disabled={archiving}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmArchive}
              disabled={archiving}
            >
              {archiving ? "Archiving…" : "Archive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview sheet */}
      <Sheet open={!!previewTemplate} onOpenChange={(open) => !open && setPreviewTemplate(null)}>
        <SheetContent side="right" className="w-full sm:max-w-3xl flex flex-col p-0">
          <SheetHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
            <SheetTitle className="text-lg">{previewTemplate?.name ?? "Preview"}</SheetTitle>
            {previewTemplate && (
              <div className="flex items-center gap-3 mt-1">
                {previewTemplate.contractType && (
                  <TypeBadge type={previewTemplate.contractType as never} />
                )}
                <span className="text-xs text-muted-foreground">
                  {previewTemplate.wordCount} words
                  {typeof previewTemplate.variableCount === "number" && ` · ${previewTemplate.variableCount} variable${previewTemplate.variableCount !== 1 ? "s" : ""}`}
                  {typeof previewTemplate.usageCount === "number" && previewTemplate.usageCount > 0 && ` · used ${previewTemplate.usageCount.toLocaleString()}×`}
                </span>
              </div>
            )}
          </SheetHeader>

          {previewTemplate && (
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Description */}
              {previewTemplate.description && (
                <div className="px-6 py-3 border-b border-border/50 shrink-0">
                  <p className="text-sm text-muted-foreground">{previewTemplate.description}</p>
                </div>
              )}

              {/* Variables */}
              {previewVariables.length > 0 && (
                <div className="px-6 py-3 border-b border-border/50 shrink-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Variables</p>
                  <div className="flex flex-wrap gap-1.5">
                    {previewVariables.map((v) => (
                      <span key={v.name} className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-700 font-medium">
                        {v.label ?? v.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Content preview */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {previewLoading ? (
                  <div className="space-y-2 animate-pulse">
                    {[...Array(8)].map((_, i) => (
                      <div key={i} className={`h-3 rounded bg-muted ${i === 0 ? "w-1/2 h-4" : i % 5 === 0 ? "w-2/3" : "w-full"}`} />
                    ))}
                  </div>
                ) : previewContent ? (
                  <pre className="whitespace-pre-wrap font-sans text-sm text-foreground/80 leading-relaxed">
                    {previewContent}
                  </pre>
                ) : (
                  <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                    No content preview available
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="px-6 py-4 border-t border-border bg-muted/20 shrink-0 flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setPreviewTemplate(null)
                    setUsingTemplateId(previewTemplate.id)
                  }}
                >
                  Use template
                </Button>
                {canManage && (
                  <Link
                    href={`/templates/${previewTemplate.id}/edit`}
                    className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-3 text-[0.8125rem] font-medium text-foreground shadow-sm hover:bg-muted transition-colors"
                  >
                    Edit
                  </Link>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

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

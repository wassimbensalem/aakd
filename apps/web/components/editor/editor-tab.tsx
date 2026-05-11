"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { formatDistanceToNow } from "date-fns"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { FileUploadZone } from "@/components/file-upload-zone"
import { ContractEditor, EMPTY_DOC, acceptAllChanges, rejectAllChanges } from "@/components/editor/contract-editor"
import { cn } from "@/lib/utils"
import type { ContractStatus } from "@/lib/types"
import { useSession } from "@/lib/auth/client"
import { Check, Trash2, MessageSquare, GitBranch, CheckCircle2 } from "lucide-react"
import type { Editor } from "@tiptap/react"

const READ_ONLY_STATUSES = new Set<ContractStatus>([
  "AWAITING_SIGNATURE",
  "ACTIVE",
  "EXPIRED",
  "TERMINATED",
  "ARCHIVED",
])

// ─── Types ────────────────────────────────────────────────────────────────────

interface CommentAuthor {
  id: string
  name: string | null
  image: string | null
}

export interface CommentData {
  id: string
  contractId: string
  authorId: string
  author: CommentAuthor
  body: string
  markId: string | null
  resolved: boolean
  resolvedById: string | null
  resolvedBy: CommentAuthor | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

// ─── Change extraction helper ─────────────────────────────────────────────────

function extractChanges(json: unknown): { type: "insertion" | "deletion"; text: string }[] {
  const results: { type: "insertion" | "deletion"; text: string }[] = []
  function walk(node: Record<string, unknown>) {
    if (node.type === "text" && Array.isArray(node.marks)) {
      for (const mark of node.marks as Record<string, unknown>[]) {
        if (mark.type === "insertion" || mark.type === "deletion") {
          results.push({ type: mark.type as "insertion" | "deletion", text: (node.text as string) ?? "" })
        }
      }
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content as Record<string, unknown>[]) walk(child)
    }
  }
  if (json && typeof json === "object") walk(json as Record<string, unknown>)
  return results
}

// ─── Avatar helper ────────────────────────────────────────────────────────────

function getInitials(name: string | null): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return (parts[0]?.[0] ?? "?").toUpperCase()
}

const AVATAR_COLORS = [
  "bg-violet-500", "bg-blue-500", "bg-emerald-500", "bg-amber-500",
  "bg-rose-500", "bg-cyan-500", "bg-indigo-500", "bg-pink-500",
]

function avatarColor(name: string | null): string {
  if (!name) return AVATAR_COLORS[0]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffff
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface EditorTabProps {
  contractId: string
  contractStatus: ContractStatus
  role: "admin" | "legal" | "member" | "viewer" | string
}

// ─── EditorTab component ──────────────────────────────────────────────────────

export function EditorTab({ contractId, contractStatus, role }: EditorTabProps) {
  const { data: session } = useSession()
  const currentUserId = session?.user?.id
  const currentUserName = session?.user?.name ?? undefined

  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState<unknown | null>(null)
  const [version, setVersion] = useState<number>(0)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importBusy, setImportBusy] = useState<"idle" | "uploading" | "converting">("idle")
  const [exportFormat, setExportFormat] = useState<"docx" | "pdf" | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [extractOpen, setExtractOpen] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [rightTab, setRightTab] = useState<"details" | "comments" | "changes">("details")

  // Comments state
  const [comments, setComments] = useState<CommentData[]>([])
  const [addCommentOpen, setAddCommentOpen] = useState(false)
  const [addCommentBody, setAddCommentBody] = useState("")
  const [addCommentBusy, setAddCommentBusy] = useState(false)
  const pendingMarkIdRef = useRef<string | null>(null)
  const pendingSelectionRef = useRef<{ from: number; to: number } | null>(null)

  // Editor ref for imperative calls (track changes)
  const editorRef = useRef<Editor | null>(null)

  // Clause navigation state
  const [activeHeading, setActiveHeading] = useState<string | null>(null)

  // Track changes state — derive from editor content
  const [editorJson, setEditorJson] = useState<unknown>(null)

  const canEdit = role !== "viewer" && !READ_ONLY_STATUSES.has(contractStatus)
  const canExtract = role === "admin" || role === "legal"

  // ─── Fetch document ────────────────────────────────────────────────────────

  const loadDocument = useCallback(async () => {
    try {
      const res = await fetch(`/api/contracts/${contractId}/document`)
      if (!res.ok) {
        toast.error("Failed to load document")
        setLoading(false)
        return
      }
      const data = await res.json()
      if (data.document) {
        setContent(data.document.content ?? EMPTY_DOC)
        setVersion(data.document.version)
      } else {
        setContent(EMPTY_DOC)
        setVersion(0)
      }
    } catch (err) {
      console.error("[editor-tab] load failed:", err)
      toast.error("Failed to load document")
    } finally {
      setLoading(false)
    }
  }, [contractId])

  useEffect(() => {
    loadDocument()
  }, [loadDocument])

  // ─── Fetch comments ────────────────────────────────────────────────────────

  const loadComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/contracts/${contractId}/comments`)
      if (!res.ok) return
      const data = await res.json() as { comments: CommentData[] }
      setComments(data.comments)
    } catch {
      // silently ignore
    }
  }, [contractId])

  useEffect(() => {
    loadComments()
  }, [loadComments])

  // ─── Poll timers ───────────────────────────────────────────────────────────

  const MAX_POLL_ATTEMPTS = 120
  const importPollHandle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const exportPollHandle = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (importPollHandle.current) clearTimeout(importPollHandle.current)
    if (exportPollHandle.current) clearTimeout(exportPollHandle.current)
  }, [])

  // ─── Import ────────────────────────────────────────────────────────────────

  async function handleImport() {
    if (!importFile) return
    setImportBusy("uploading")
    try {
      const fd = new FormData()
      fd.append("file", importFile)
      const res = await fetch(`/api/contracts/${contractId}/document/import`, {
        method: "POST",
        body: fd,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        if (body.error === "invalid_file_type") {
          toast.error("Only .docx and .pdf files are accepted.")
        } else if (body.error === "file_too_large") {
          toast.error("File too large (max 25 MB).")
        } else if (body.error === "read_only_status") {
          toast.error("This contract is read-only.")
        } else {
          toast.error("Import failed.")
        }
        setImportBusy("idle")
        return
      }
      const { jobId } = await res.json()
      setImportBusy("converting")

      const poll = async (attempts = 0): Promise<void> => {
        if (attempts >= MAX_POLL_ATTEMPTS) {
          toast.error("Import timed out. Please check back later.")
          setImportBusy("idle")
          return
        }
        const r = await fetch(`/api/contracts/${contractId}/document/import/${jobId}`)
        if (!r.ok) {
          toast.error("Import failed.")
          setImportBusy("idle")
          return
        }
        const status = await r.json()
        if (status.status === "complete") {
          await loadDocument()
          setImportOpen(false)
          setImportFile(null)
          setImportBusy("idle")
          toast.success("Imported")
        } else if (status.status === "failed") {
          toast.error(`Import failed: ${status.error ?? "unknown error"}`)
          setImportBusy("idle")
        } else {
          importPollHandle.current = setTimeout(() => poll(attempts + 1), 1000)
        }
      }
      poll()
    } catch (err) {
      console.error("[editor-tab] import failed:", err)
      toast.error("Import failed.")
      setImportBusy("idle")
    }
  }

  // ─── Export ────────────────────────────────────────────────────────────────

  async function handleExport(format: "docx" | "pdf") {
    setExportFormat(format)
    setExportBusy(true)
    try {
      const res = await fetch(`/api/contracts/${contractId}/document/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        if (body.error === "no_document") {
          toast.error("Save the document before exporting.")
        } else {
          toast.error("Export failed.")
        }
        setExportBusy(false)
        setExportFormat(null)
        return
      }
      const { jobId } = await res.json()
      const poll = async (attempts = 0): Promise<void> => {
        if (attempts >= MAX_POLL_ATTEMPTS) {
          toast.error("Export timed out. Please check back later.")
          setExportBusy(false)
          setExportFormat(null)
          return
        }
        const r = await fetch(`/api/contracts/${contractId}/document/export/${jobId}`)
        if (!r.ok) {
          if (exportPollHandle.current) clearTimeout(exportPollHandle.current)
          toast.error("Export failed — please try again")
          setExportBusy(false)
          setExportFormat(null)
          return
        }
        const status = await r.json()
        if (status.status === "complete" && status.downloadUrl) {
          const a = document.createElement("a")
          a.href = status.downloadUrl
          const stamp = new Date().toISOString().slice(0, 10)
          a.download = `contract-${stamp}.${format}`
          a.click()
          toast.success("Exported")
          setExportBusy(false)
          setExportFormat(null)
          return
        }
        if (status.status === "failed") {
          toast.error(`Export failed: ${status.error ?? "unknown"}`)
          setExportBusy(false)
          setExportFormat(null)
          return
        }
        exportPollHandle.current = setTimeout(() => poll(attempts + 1), 1000)
      }
      poll()
    } catch (err) {
      console.error("[editor-tab] export failed:", err)
      toast.error("Export failed.")
      setExportBusy(false)
      setExportFormat(null)
    }
  }

  // ─── AI Extraction ─────────────────────────────────────────────────────────

  async function handleSendForExtraction() {
    setExtracting(true)
    try {
      const res = await fetch(`/api/contracts/${contractId}/document/extract`, {
        method: "POST",
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? "Failed to queue extraction")
        return
      }
      toast.success("Extraction queued")
      setExtractOpen(false)
    } catch (err) {
      console.error("[editor-tab] extract failed:", err)
      toast.error("Failed to queue extraction")
    } finally {
      setExtracting(false)
    }
  }

  // ─── Add comment ───────────────────────────────────────────────────────────

  function handleAddComment() {
    if (!editorRef.current) return
    const editor = editorRef.current
    if (editor.state.selection.empty) return

    // Save the current selection range so we can apply the mark after the form submits
    const { from, to } = editor.state.selection
    pendingSelectionRef.current = { from, to }
    pendingMarkIdRef.current = crypto.randomUUID()
    setAddCommentBody("")
    setAddCommentOpen(true)
    setRightTab("comments")
  }

  async function handleSubmitComment() {
    const body = addCommentBody.trim()
    if (!body || !pendingMarkIdRef.current) return
    setAddCommentBusy(true)
    try {
      const res = await fetch(`/api/contracts/${contractId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, markId: pendingMarkIdRef.current }),
      })
      if (!res.ok) {
        toast.error("Failed to post comment")
        return
      }
      const data = await res.json() as { comment: CommentData }

      // Apply the comment mark to the editor selection
      if (editorRef.current && pendingSelectionRef.current) {
        const { from, to } = pendingSelectionRef.current
        const markId = pendingMarkIdRef.current
        editorRef.current
          .chain()
          .setTextSelection({ from, to })
          .setMark("comment", { commentId: markId })
          .run()
      }

      setComments((prev) => [...prev, data.comment])
      setAddCommentOpen(false)
      setAddCommentBody("")
      pendingMarkIdRef.current = null
      pendingSelectionRef.current = null
      toast.success("Comment added")
    } catch {
      toast.error("Failed to post comment")
    } finally {
      setAddCommentBusy(false)
    }
  }

  // ─── Resolve comment ───────────────────────────────────────────────────────

  async function handleResolveComment(commentId: string, resolved: boolean) {
    try {
      const res = await fetch(`/api/contracts/${contractId}/comments/${commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved }),
      })
      if (!res.ok) { toast.error("Failed to update comment"); return }
      const data = await res.json() as { comment: CommentData }
      setComments((prev) => prev.map((c) => c.id === commentId ? data.comment : c))
    } catch {
      toast.error("Failed to update comment")
    }
  }

  // ─── Delete comment ────────────────────────────────────────────────────────

  async function handleDeleteComment(commentId: string) {
    try {
      const res = await fetch(`/api/contracts/${contractId}/comments/${commentId}`, {
        method: "DELETE",
      })
      if (!res.ok) { toast.error("Failed to delete comment"); return }
      setComments((prev) => prev.filter((c) => c.id !== commentId))
      toast.success("Comment deleted")
    } catch {
      toast.error("Failed to delete comment")
    }
  }

  // ─── Scroll to marked text ─────────────────────────────────────────────────

  function scrollToMark(markId: string) {
    if (!editorRef.current) return
    const editor = editorRef.current
    // Find nodes that have the comment mark with this markId
    let found = false
    editor.state.doc.descendants((node, pos) => {
      if (found) return false
      if (node.isText) {
        const commentMark = node.marks.find(
          (m) => m.type.name === "comment" && (m.attrs as { commentId?: string }).commentId === markId,
        )
        if (commentMark) {
          editor.commands.setTextSelection(pos)
          editor.commands.scrollIntoView()
          found = true
          return false
        }
      }
    })
  }

  // ─── Scroll to heading ─────────────────────────────────────────────────────

  function scrollToHeading(title: string) {
    if (!editorRef.current) return
    const editor = editorRef.current
    let found = false
    editor.state.doc.descendants((node, pos) => {
      if (found) return false
      if (node.type.name === "heading") {
        const text = node.textContent
        if (text === title) {
          editor.commands.setTextSelection(pos)
          editor.commands.scrollIntoView()
          found = true
          return false
        }
      }
    })
  }

  // ─── Handle accept/reject all ──────────────────────────────────────────────

  function handleAcceptAllChanges() {
    if (!editorRef.current) return
    acceptAllChanges(editorRef.current)
    // Re-sync editor json
    setEditorJson(editorRef.current.getJSON())
  }

  function handleRejectAllChanges() {
    if (!editorRef.current) return
    rejectAllChanges(editorRef.current)
    setEditorJson(editorRef.current.getJSON())
  }

  // ─── TOC derivation ────────────────────────────────────────────────────────

  const tocItems = useMemo(() => {
    if (!content) return []

    type AnyNode = { type?: string; content?: AnyNode[]; children?: Array<{ text?: string }>; attrs?: { level?: number } }
    let nodes: AnyNode[] = []
    if (Array.isArray(content)) {
      nodes = content as AnyNode[]
    } else {
      const doc = content as { type?: string; content?: AnyNode[] }
      if (doc.type === "doc" && Array.isArray(doc.content)) {
        nodes = doc.content
      }
    }

    const headings = nodes.filter((n) =>
      n.type === "heading" ||
      n.type === "h1" || n.type === "h2" || n.type === "h3"
    )

    return headings.map((n, i) => {
      let title = ""
      if (n.type === "heading" && Array.isArray(n.content)) {
        title = n.content
          .map((c: AnyNode & { text?: string }) => c.text ?? "")
          .join("")
          .trim()
      } else if (Array.isArray(n.children)) {
        title = n.children.map((c) => c.text ?? "").join("").trim()
      }
      return {
        num: String(i + 1),
        title: title || `Section ${i + 1}`,
      }
    })
  }, [content])

  // ─── Derived counts ────────────────────────────────────────────────────────

  const unresolvedComments = comments.filter((c) => !c.resolved).length
  const changes = useMemo(() => extractChanges(editorJson), [editorJson])
  const changeCount = changes.length

  // ─── Loading skeleton ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-1 overflow-hidden animate-pulse">
        <div className="w-[200px] shrink-0 border-r border-border bg-muted/30 p-3 space-y-2">
          <div className="h-3 w-16 rounded bg-zinc-200" />
          <div className="h-4 w-full rounded bg-zinc-100" />
          <div className="h-4 w-4/5 rounded bg-zinc-100" />
          <div className="h-4 w-3/5 rounded bg-zinc-100" />
        </div>
        <div className="flex-1 p-8 space-y-3">
          <div className="h-6 w-1/3 rounded bg-zinc-200" />
          <div className="h-4 w-full rounded bg-zinc-100" />
          <div className="h-4 w-full rounded bg-zinc-100" />
          <div className="h-4 w-4/5 rounded bg-zinc-100" />
          <div className="h-4 w-0 rounded bg-transparent" />
          <div className="h-4 w-full rounded bg-zinc-100" />
          <div className="h-4 w-full rounded bg-zinc-100" />
          <div className="h-4 w-2/3 rounded bg-zinc-100" />
        </div>
        <div className="w-[300px] shrink-0 border-l border-border p-3 space-y-2">
          <div className="h-3 w-20 rounded bg-zinc-200" />
          <div className="h-7 w-full rounded bg-zinc-100" />
          <div className="h-7 w-full rounded bg-zinc-100" />
        </div>
      </div>
    )
  }

  const documentExists = content !== null
  const showSendForExtraction = canExtract && documentExists

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── 3-column body ───────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT: Clause outline (200px) */}
        <aside className="w-[200px] shrink-0 border-r border-border bg-muted/30 overflow-y-auto flex flex-col">
          <div className="px-3.5 pt-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground flex items-center">
            <span>Clauses</span>
            {unresolvedComments > 0 && (
              <span className="ml-auto text-[10px] text-amber-600 font-semibold">{unresolvedComments}</span>
            )}
          </div>
          {tocItems.length === 0 ? (
            <div className="px-3.5 text-[11px] text-muted-foreground/60 italic">No headings yet</div>
          ) : (
            tocItems.map((item, i) => (
              <button
                key={i}
                type="button"
                onClick={() => scrollToHeading(item.title)}
                className={cn(
                  "flex items-center gap-2 w-full px-3.5 py-1.5 text-left text-[12px] hover:bg-muted/50 transition-colors cursor-pointer",
                  activeHeading === item.title
                    ? "text-primary font-medium bg-primary/5"
                    : "text-foreground/80"
                )}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0" />
                <span className="text-[10.5px] text-muted-foreground min-w-[18px]">{item.num}</span>
                <span className="truncate">{item.title}</span>
              </button>
            ))
          )}
        </aside>

        {/* CENTER: Editor (flex-1) */}
        <div className="flex-1 overflow-auto bg-muted/10">
          <div className="max-w-[720px] mx-auto px-8 py-6">
            {/* Change/comment info bar */}
            {(changeCount > 0 || unresolvedComments > 0) && (
              <div className="flex items-center gap-3 px-2 pb-2 text-xs text-muted-foreground">
                {changeCount > 0 && (
                  <span className="flex items-center gap-1 text-amber-600">
                    <GitBranch className="size-3" /> {changeCount} change{changeCount !== 1 ? "s" : ""}
                  </span>
                )}
                {unresolvedComments > 0 && (
                  <span className="flex items-center gap-1 text-blue-600">
                    <MessageSquare className="size-3" /> {unresolvedComments} comment{unresolvedComments !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            )}

            <ContractEditor
              contractId={contractId}
              initialContent={content ?? EMPTY_DOC}
              initialVersion={version}
              readOnly={!canEdit}
              readOnlyReason={
                !canEdit
                  ? `This contract is in ${contractStatus} status. The editor is read-only.`
                  : undefined
              }
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              onAddComment={handleAddComment}
              onAcceptAllChanges={handleAcceptAllChanges}
              onRejectAllChanges={handleRejectAllChanges}
              onSelectionChange={setActiveHeading}
              onEditorReady={(ed) => { editorRef.current = ed }}
              onChange={(json) => {
                setEditorJson(json)
              }}
            />
          </div>
        </div>

        {/* RIGHT: Details / Comments / Changes (300px) */}
        <aside className="w-[300px] shrink-0 border-l border-border flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-border shrink-0">
            <button
              type="button"
              onClick={() => setRightTab("details")}
              className={cn(
                "flex-1 py-2.5 text-[11px] font-medium capitalize transition-colors",
                rightTab === "details"
                  ? "border-b-2 border-primary text-primary"
                  : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Details
            </button>
            <button
              type="button"
              onClick={() => setRightTab("comments")}
              className={cn(
                "flex-1 py-2.5 text-[11px] font-medium transition-colors",
                rightTab === "comments"
                  ? "border-b-2 border-primary text-primary"
                  : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Comments{comments.length > 0 ? ` (${comments.length})` : ""}
            </button>
            <button
              type="button"
              onClick={() => setRightTab("changes")}
              className={cn(
                "flex-1 py-2.5 text-[11px] font-medium transition-colors",
                rightTab === "changes"
                  ? "border-b-2 border-primary text-primary"
                  : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Changes{changeCount > 0 ? ` (${changeCount})` : ""}
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-3">

            {/* ── Details tab ───────────────────────────────── */}
            {rightTab === "details" && (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold pt-1">Document</p>
                {canEdit && (
                  <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setImportOpen(true)}>
                    Import from Word or PDF
                  </Button>
                )}
                {documentExists && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start"
                      disabled={exportBusy}
                      onClick={() => handleExport("docx")}
                    >
                      {exportBusy && exportFormat === "docx" ? "Exporting…" : "Export to Word"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start"
                      disabled={exportBusy}
                      onClick={() => handleExport("pdf")}
                    >
                      {exportBusy && exportFormat === "pdf" ? "Exporting…" : "Export to PDF"}
                    </Button>
                  </>
                )}
                {showSendForExtraction && (
                  <>
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold pt-3">AI</p>
                    <Button
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => setExtractOpen(true)}
                      disabled={extracting}
                    >
                      Re-run AI Extraction
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* ── Comments tab ──────────────────────────────── */}
            {rightTab === "comments" && (
              <div className="space-y-2">
                {comments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center gap-2 py-12">
                    <div className="text-muted-foreground/40">
                      <MessageSquare className="size-7" />
                    </div>
                    <p className="text-[12px] text-muted-foreground">No comments yet</p>
                    <p className="text-[11px] text-muted-foreground/60">Select text and click the comment button to add one.</p>
                  </div>
                ) : (
                  comments.map((comment) => (
                    <div
                      key={comment.id}
                      className={cn(
                        "rounded-lg border p-3 space-y-2 transition-colors",
                        comment.resolved ? "border-border/50 bg-muted/20 opacity-70" : "border-border bg-background"
                      )}
                    >
                      {/* Header */}
                      <div className="flex items-start gap-2">
                        <div className={cn(
                          "size-7 rounded-full shrink-0 flex items-center justify-center text-white text-[11px] font-semibold",
                          avatarColor(comment.author.name),
                        )}>
                          {getInitials(comment.author.name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium text-foreground truncate">
                            {comment.author.name ?? "Unknown"}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                          </p>
                        </div>
                        {comment.resolved && (
                          <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-medium shrink-0">
                            Resolved
                          </span>
                        )}
                      </div>

                      {/* Body */}
                      {comment.markId ? (
                        <button
                          type="button"
                          onClick={() => scrollToMark(comment.markId!)}
                          className="w-full text-left text-[12px] text-foreground/90 hover:text-foreground transition-colors"
                        >
                          {comment.body}
                        </button>
                      ) : (
                        <p className="text-[12px] text-foreground/90">{comment.body}</p>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-1 pt-0.5">
                        <button
                          type="button"
                          onClick={() => handleResolveComment(comment.id, !comment.resolved)}
                          title={comment.resolved ? "Unresolve" : "Resolve"}
                          className={cn(
                            "inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded transition-colors",
                            comment.resolved
                              ? "text-muted-foreground hover:text-foreground"
                              : "text-emerald-700 hover:bg-emerald-50"
                          )}
                        >
                          <CheckCircle2 className="size-3.5" />
                          {comment.resolved ? "Unresolve" : "Resolve"}
                        </button>
                        {comment.authorId === currentUserId && (
                          <button
                            type="button"
                            onClick={() => handleDeleteComment(comment.id)}
                            title="Delete comment"
                            className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded text-red-600 hover:bg-red-50 transition-colors ml-auto"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ── Changes tab ───────────────────────────────── */}
            {rightTab === "changes" && (
              <div className="space-y-2">
                {changeCount > 0 && (
                  <div className="flex gap-2 pb-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-emerald-700 border-emerald-200 hover:bg-emerald-50 text-[11px]"
                      onClick={handleAcceptAllChanges}
                    >
                      <Check className="size-3.5 mr-1" />
                      Accept All
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-red-700 border-red-200 hover:bg-red-50 text-[11px]"
                      onClick={handleRejectAllChanges}
                    >
                      Reject All
                    </Button>
                  </div>
                )}
                {changes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center gap-2 py-12">
                    <div className="text-muted-foreground/40">
                      <GitBranch className="size-7" />
                    </div>
                    <p className="text-[12px] text-muted-foreground">No tracked changes</p>
                    <p className="text-[11px] text-muted-foreground/60">Enable Track Changes in the toolbar to start tracking edits.</p>
                  </div>
                ) : (
                  changes.map((change, i) => (
                    <div
                      key={i}
                      className={cn(
                        "rounded-md border px-2.5 py-2 text-[12px]",
                        change.type === "insertion"
                          ? "border-emerald-200 bg-emerald-50/50 text-emerald-800"
                          : "border-red-200 bg-red-50/50 text-red-800"
                      )}
                    >
                      <span className="font-semibold mr-1.5">
                        {change.type === "insertion" ? "+" : "-"}
                      </span>
                      <span className="break-words">{change.text}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ── Add Comment inline form ──────────────────────────────────────────── */}
      {addCommentOpen && (
        <div className="border-t border-border bg-background px-4 py-3 space-y-2 shrink-0">
          <p className="text-[12px] font-medium text-foreground">Add a comment</p>
          <textarea
            autoFocus
            value={addCommentBody}
            onChange={(e) => setAddCommentBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void handleSubmitComment()
              }
              if (e.key === "Escape") {
                setAddCommentOpen(false)
                setAddCommentBody("")
              }
            }}
            placeholder="Write a comment… (Cmd+Enter to submit)"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex gap-2 justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setAddCommentOpen(false)
                setAddCommentBody("")
              }}
              disabled={addCommentBusy}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSubmitComment()}
              disabled={!addCommentBody.trim() || addCommentBusy}
            >
              {addCommentBusy ? "Posting…" : "Post"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Dialogs ─────────────────────────────────────────── */}
      <Dialog open={importOpen} onOpenChange={(open) => !importBusy && setImportOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import from Word or PDF</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <FileUploadZone onFileSelect={setImportFile} accept=".docx,.pdf" />
            <p className="text-xs text-amber-700">
              Importing will replace the current editor content. This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importBusy !== "idle"}>
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={!importFile || importBusy !== "idle"}>
                {importBusy === "uploading" ? "Uploading…" : importBusy === "converting" ? "Converting…" : "Import"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={extractOpen} onOpenChange={(open) => !extracting && setExtractOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send editor content for AI extraction?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-600">
            This will replace any previously extracted text with the current editor content
            and re-run AI extraction.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setExtractOpen(false)} disabled={extracting}>
              Cancel
            </Button>
            <Button onClick={handleSendForExtraction} disabled={extracting}>
              {extracting ? "Queuing…" : "Send"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

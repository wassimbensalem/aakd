"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { FileUploadZone } from "@/components/file-upload-zone"
import { ContractEditor, EMPTY_DOC } from "@/components/editor/contract-editor"
import { cn } from "@/lib/utils"
import type { ContractStatus } from "@/lib/types"

const READ_ONLY_STATUSES = new Set<ContractStatus>([
  "AWAITING_SIGNATURE",
  "ACTIVE",
  "EXPIRED",
  "TERMINATED",
  "ARCHIVED",
])

export interface EditorTabProps {
  contractId: string
  contractStatus: ContractStatus
  role: "admin" | "legal" | "member" | "viewer" | string
}

export function EditorTab({ contractId, contractStatus, role }: EditorTabProps) {
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
  const [rightTab, setRightTab] = useState<"details" | "comments">("details")

  const canEdit = role !== "viewer" && !READ_ONLY_STATUSES.has(contractStatus)
  const canExtract = role === "admin" || role === "legal"

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

  const MAX_POLL_ATTEMPTS = 120
  const importPollHandle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const exportPollHandle = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (importPollHandle.current) clearTimeout(importPollHandle.current)
    if (exportPollHandle.current) clearTimeout(exportPollHandle.current)
  }, [])

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

  // Derive TOC from document content.
  // Supports both TipTap format ({ type: "doc", content: [...] }) and legacy Slate arrays.
  const tocItems = useMemo(() => {
    if (!content) return []

    // Flatten content to an array of nodes to inspect
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
      // TipTap
      n.type === "heading" ||
      // Legacy Slate
      n.type === "h1" || n.type === "h2" || n.type === "h3"
    )

    return headings.map((n, i) => {
      let title = ""
      if (n.type === "heading" && Array.isArray(n.content)) {
        // TipTap: collect text from content[].text
        title = n.content
          .map((c: AnyNode & { text?: string }) => c.text ?? "")
          .join("")
          .trim()
      } else if (Array.isArray(n.children)) {
        // Legacy Slate: children are text leaves
        title = n.children.map((c) => c.text ?? "").join("").trim()
      }
      return {
        num: String(i + 1),
        title: title || `Section ${i + 1}`,
      }
    })
  }, [content])

  if (loading) {
    return (
      <div className="flex flex-1 overflow-hidden animate-pulse">
        {/* Left skeleton */}
        <div className="w-[200px] shrink-0 border-r border-border bg-muted/30 p-3 space-y-2">
          <div className="h-3 w-16 rounded bg-zinc-200" />
          <div className="h-4 w-full rounded bg-zinc-100" />
          <div className="h-4 w-4/5 rounded bg-zinc-100" />
          <div className="h-4 w-3/5 rounded bg-zinc-100" />
        </div>
        {/* Center skeleton */}
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
        {/* Right skeleton */}
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
          <div className="px-3.5 pt-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Clauses
          </div>
          {tocItems.length === 0 ? (
            <div className="px-3.5 text-[11px] text-muted-foreground/60 italic">No headings yet</div>
          ) : (
            tocItems.map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-2 w-full px-3.5 py-1.5 text-left text-[12px] hover:bg-muted/50 transition-colors text-foreground/80 cursor-default"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0" />
                <span className="text-[10.5px] text-muted-foreground min-w-[18px]">{item.num}</span>
                <span className="truncate">{item.title}</span>
              </div>
            ))
          )}
        </aside>

        {/* CENTER: Editor (flex-1) */}
        <div className="flex-1 overflow-auto bg-muted/10">
          <div className="max-w-[720px] mx-auto px-8 py-6">
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
            />
          </div>
        </div>

        {/* RIGHT: Details / Comments (300px) */}
        <aside className="w-[300px] shrink-0 border-l border-border flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-border shrink-0">
            {(["details", "comments"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setRightTab(t)}
                className={cn(
                  "flex-1 py-2.5 text-[12px] font-medium capitalize transition-colors",
                  rightTab === t
                    ? "border-b-2 border-primary text-primary"
                    : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-3">
            {rightTab === "details" ? (
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
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center gap-2 py-12">
                <div className="text-muted-foreground/40">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                </div>
                <p className="text-[12px] text-muted-foreground">No comments yet</p>
                <p className="text-[11px] text-muted-foreground/60">Comments coming in a future update</p>
              </div>
            )}
          </div>
        </aside>
      </div>

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

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { Descendant } from "slate"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { FileUploadZone } from "@/components/file-upload-zone"
import { ContractEditor, EMPTY_DOC } from "@/components/editor/contract-editor"
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
  const [content, setContent] = useState<Descendant[] | null>(null)
  const [version, setVersion] = useState<number>(0)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importBusy, setImportBusy] = useState<"idle" | "uploading" | "converting">("idle")
  const [exportFormat, setExportFormat] = useState<"docx" | "pdf" | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [extractOpen, setExtractOpen] = useState(false)
  const [extracting, setExtracting] = useState(false)

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
        setContent(
          Array.isArray(data.document.content) && data.document.content.length > 0
            ? (data.document.content as Descendant[])
            : EMPTY_DOC,
        )
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
          toast.error("Only .docx files are accepted.")
        } else if (body.error === "file_too_large") {
          toast.error("File too large (max 10 MB).")
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

  if (loading) {
    return <div className="text-sm text-zinc-500">Loading editor…</div>
  }

  const documentExists = content !== null
  const showSendForExtraction = canExtract && documentExists

  return (
    <div className="space-y-4">
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
        rightActions={
          <>
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportOpen(true)}
              >
                Import from Word
              </Button>
            )}
            {documentExists && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exportBusy}
                  onClick={() => handleExport("docx")}
                >
                  {exportBusy && exportFormat === "docx" ? "Exporting…" : "Export to Word"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exportBusy}
                  onClick={() => handleExport("pdf")}
                >
                  {exportBusy && exportFormat === "pdf" ? "Exporting…" : "Export to PDF"}
                </Button>
              </>
            )}
            {showSendForExtraction && (
              <Button
                size="sm"
                onClick={() => setExtractOpen(true)}
                disabled={extracting}
              >
                Send for Extraction
              </Button>
            )}
          </>
        }
      />

      <Dialog open={importOpen} onOpenChange={(open) => !importBusy && setImportOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import from Word</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <FileUploadZone onFileSelect={setImportFile} accept=".docx" />
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

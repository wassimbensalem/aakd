"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { ChevronRight, FileText, Folder, Loader2, AlertTriangle, Home } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ImportProgressView } from "./import-progress-view"
import { formatBytes } from "./types"

interface DriveFile {
  id: string
  name: string
  mimeType: string
  sizeBytes: number | null
  modifiedAt: string | null
}

interface DriveFilesResponse {
  folderId: string
  files: DriveFile[]
  truncated: boolean
}

interface ConnectionStatus {
  state: "loading" | "not_configured" | "not_connected" | "connected" | "error"
  connectedBy?: { name: string }
  error?: string
}

const FOLDER_MIME = "application/vnd.google-apps.folder"
const MAX_SELECTION = 50

export function GoogleDriveTab({ onJobCreated }: { onJobCreated?: () => void }) {
  const [conn, setConn] = useState<ConnectionStatus>({ state: "loading" })
  const [, setFolderId] = useState<string | null>(null)
  const [breadcrumb, setBreadcrumb] = useState<{ id: string | null; name: string }[]>([
    { id: null, name: "My Drive" },
  ])
  const [files, setFiles] = useState<DriveFile[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)

  const loadFiles = useCallback(async (id: string | null) => {
    setLoadingFiles(true)
    try {
      const url = id ? `/api/import/gdrive/files?folderId=${encodeURIComponent(id)}` : "/api/import/gdrive/files"
      const res = await fetch(url)
      if (res.status === 503) {
        setConn({ state: "not_configured" })
        return
      }
      if (res.status === 404) {
        setConn({ state: "not_connected" })
        return
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error ?? `Failed (${res.status})`)
      }
      const data = (await res.json()) as DriveFilesResponse & { connectedBy?: { name: string } }
      setFiles(data.files)
      setTruncated(data.truncated)
      setConn((prev) =>
        prev.state === "connected" ? prev : { state: "connected", connectedBy: data.connectedBy }
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load Drive files")
      setConn({ state: "error", error: e instanceof Error ? e.message : "Unknown error" })
    } finally {
      setLoadingFiles(false)
    }
  }, [])

  // Initial probe
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/import/gdrive/files")
        if (cancelled) return
        if (res.status === 503) {
          setConn({ state: "not_configured" })
          return
        }
        if (res.status === 404) {
          setConn({ state: "not_connected" })
          return
        }
        if (!res.ok) {
          throw new Error(`Failed (${res.status})`)
        }
        const data = (await res.json()) as DriveFilesResponse & { connectedBy?: { name: string } }
        setFiles(data.files)
        setTruncated(data.truncated)
        setConn({ state: "connected", connectedBy: data.connectedBy })
      } catch (e) {
        if (cancelled) return
        setConn({ state: "error", error: e instanceof Error ? e.message : "Unknown error" })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function navigateInto(file: DriveFile) {
    setSelected(new Set())
    setFolderId(file.id)
    setBreadcrumb((prev) => [...prev, { id: file.id, name: file.name }])
    loadFiles(file.id)
  }

  function navigateTo(index: number) {
    const trail = breadcrumb.slice(0, index + 1)
    setBreadcrumb(trail)
    const target = trail[trail.length - 1]?.id ?? null
    setFolderId(target)
    setSelected(new Set())
    loadFiles(target)
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectableFiles = files.filter((f) => f.mimeType !== FOLDER_MIME)

  function selectAll() {
    setSelected(new Set(selectableFiles.map((f) => f.id)))
  }
  function deselectAll() {
    setSelected(new Set())
  }

  async function disconnect() {
    if (!confirm("Disconnect Google Drive? You'll need to re-authorize to import again.")) return
    try {
      const res = await fetch("/api/import/gdrive/connect", { method: "DELETE" })
      if (!res.ok) throw new Error()
      toast.success("Disconnected from Google Drive")
      setConn({ state: "not_connected" })
      setFiles([])
      setBreadcrumb([{ id: null, name: "My Drive" }])
      setFolderId(null)
      setSelected(new Set())
    } catch {
      toast.error("Failed to disconnect")
    }
  }

  async function importSelected() {
    if (selected.size === 0) return
    setImporting(true)
    try {
      const res = await fetch("/api/import/gdrive/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: Array.from(selected) }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error ?? `Failed (${res.status})`)
      }
      const data = await res.json()
      setJobId(data.jobId)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start import")
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    setJobId(null)
    setSelected(new Set())
  }

  if (jobId) {
    return <ImportProgressView jobId={jobId} onComplete={onJobCreated} onReset={reset} />
  }

  if (conn.state === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking Google Drive connection...
      </div>
    )
  }

  if (conn.state === "not_configured") {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold text-zinc-900">Google Drive import not configured</p>
          <p className="text-zinc-600 mt-1">
            Set <code className="text-xs bg-white px-1 rounded">GOOGLE_CLIENT_ID</code> and{" "}
            <code className="text-xs bg-white px-1 rounded">GOOGLE_CLIENT_SECRET</code> environment variables to enable Google Drive imports.
          </p>
        </div>
      </div>
    )
  }

  if (conn.state === "not_connected") {
    return (
      <div className="space-y-4">
        <div className="text-sm text-zinc-600">
          Connect your Google account to browse Drive and import contract files directly.
        </div>
        <a href="/api/import/gdrive/connect">
          <Button>Connect Google Drive</Button>
        </a>
      </div>
    )
  }

  if (conn.state === "error") {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {conn.error ?? "Failed to load Google Drive"}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-zinc-600">
          {conn.connectedBy ? (
            <>Connected as <span className="font-medium text-zinc-900">{conn.connectedBy.name}</span></>
          ) : (
            "Connected to Google Drive"
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={disconnect}>
          Disconnect
        </Button>
      </div>

      <div className="flex items-center gap-1 text-xs text-zinc-600 flex-wrap">
        {breadcrumb.map((b, i) => (
          <span key={i} className="flex items-center gap-1">
            <button
              type="button"
              className="hover:text-indigo-600 flex items-center gap-1"
              onClick={() => navigateTo(i)}
              disabled={i === breadcrumb.length - 1}
            >
              {i === 0 && <Home className="h-3 w-3" />}
              {b.name}
            </button>
            {i < breadcrumb.length - 1 && <ChevronRight className="h-3 w-3 text-zinc-400" />}
          </span>
        ))}
      </div>

      {truncated && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing first 100 entries. Use subfolders to access more.
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 bg-white">
        <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 text-xs">
          <span className="text-zinc-500">{files.length} item{files.length === 1 ? "" : "s"}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={selectAll}
              className="text-indigo-600 hover:underline disabled:opacity-50"
              disabled={selectableFiles.length === 0}
            >
              Select all
            </button>
            <span className="text-zinc-300">·</span>
            <button
              type="button"
              onClick={deselectAll}
              className="text-zinc-500 hover:underline disabled:opacity-50"
              disabled={selected.size === 0}
            >
              Deselect all
            </button>
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto divide-y divide-zinc-100">
          {loadingFiles ? (
            <div className="flex items-center gap-2 text-sm text-zinc-500 px-4 py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : files.length === 0 ? (
            <div className="px-4 py-6 text-sm text-zinc-500 text-center">No PDF or Word files in this folder.</div>
          ) : (
            files.map((f) => {
              const isFolder = f.mimeType === FOLDER_MIME
              return (
                <div
                  key={f.id}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-zinc-50"
                >
                  {isFolder ? (
                    <span className="w-4" />
                  ) : (
                    <input
                      type="checkbox"
                      checked={selected.has(f.id)}
                      onChange={() => toggle(f.id)}
                      className="h-4 w-4 rounded accent-indigo-600"
                    />
                  )}
                  {isFolder ? (
                    <button
                      type="button"
                      className="flex items-center gap-2 flex-1 min-w-0 text-left text-sm text-zinc-900 hover:text-indigo-600"
                      onClick={() => navigateInto(f)}
                    >
                      <Folder className="h-4 w-4 text-amber-500 shrink-0" />
                      <span className="truncate">{f.name}</span>
                    </button>
                  ) : (
                    <label className="flex items-center gap-2 flex-1 min-w-0 text-sm cursor-pointer">
                      <FileText className="h-4 w-4 text-zinc-400 shrink-0" />
                      <span className="truncate text-zinc-900">{f.name}</span>
                    </label>
                  )}
                  <span className="text-xs text-zinc-500 shrink-0 w-20 text-right">
                    {isFolder ? "—" : formatBytes(f.sizeBytes ?? null)}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-zinc-500">
          {selected.size} selected
          {selected.size > MAX_SELECTION && (
            <span className="text-destructive ml-1">· max {MAX_SELECTION} per import</span>
          )}
        </p>
        <Button
          onClick={importSelected}
          disabled={selected.size === 0 || selected.size > MAX_SELECTION || importing}
        >
          {importing ? "Starting..." : `Import ${selected.size} file${selected.size === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  )
}

"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Dropzone } from "./dropzone"
import { ImportProgressView } from "./import-progress-view"
import { FIELD_OPTIONS } from "./types"

interface PreviewResponse {
  previewId: string
  storageKey: string
  headers: string[]
  suggestedMapping: Record<string, string | null>
  previewRows: string[][]
  totalRows: number
}

type Step = "upload" | "map" | "progress"

export function CsvImportTab({ onJobCreated }: { onJobCreated?: () => void }) {
  const [step, setStep] = useState<Step>("upload")
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [mapping, setMapping] = useState<Record<string, string | null>>({})
  const [jobId, setJobId] = useState<string | null>(null)

  async function handleFile(files: File[]) {
    const file = files[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/import/csv/preview", { method: "POST", body: fd })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error ?? `Upload failed (${res.status})`)
      }
      const data = (await res.json()) as PreviewResponse
      setPreview(data)
      setMapping(data.suggestedMapping ?? {})
      setStep("map")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to upload CSV")
    } finally {
      setUploading(false)
    }
  }

  async function startImport() {
    if (!preview) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/import/csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storageKey: preview.storageKey,
          mapping,
          totalRows: preview.totalRows,
        }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error ?? `Import failed (${res.status})`)
      }
      const data = await res.json()
      setJobId(data.jobId)
      setStep("progress")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start import")
    } finally {
      setSubmitting(false)
    }
  }

  function reset() {
    setStep("upload")
    setPreview(null)
    setMapping({})
    setJobId(null)
  }

  const titleMapped = useMemo(
    () => Object.values(mapping).some((v) => v === "title"),
    [mapping]
  )

  // Map CSV header index to user-chosen field for relabeling preview headers
  const previewLabels = useMemo(() => {
    if (!preview) return [] as string[]
    return preview.headers.map((h) => {
      const f = mapping[h]
      if (!f) return h
      const label = FIELD_OPTIONS.find((o) => o.value === f)?.label ?? f
      return `${h} → ${label}`
    })
  }, [preview, mapping])

  if (step === "upload") {
    return (
      <div className="space-y-4">
        <div className="text-sm text-zinc-600">
          Upload a CSV exported from a spreadsheet. The first row should be a header
          row. Up to 1,000 rows, max 10 MB.
        </div>
        <Dropzone
          accept=".csv,text/csv"
          onFiles={handleFile}
          hint="CSV file, up to 10 MB"
        />
        {uploading && (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading CSV preview...
          </div>
        )}
      </div>
    )
  }

  if (step === "map" && preview) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">Map columns</h3>
            <p className="text-xs text-zinc-500">
              {preview.totalRows} rows detected. Map at least the title column to continue.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={reset}>
            Start over
          </Button>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Your column</th>
                <th className="px-4 py-2 text-left font-medium">ClauseFlow field</th>
              </tr>
            </thead>
            <tbody>
              {preview.headers.map((header) => (
                <tr key={header} className="border-t border-zinc-100">
                  <td className="px-4 py-2 font-medium text-zinc-900 truncate max-w-xs">{header}</td>
                  <td className="px-4 py-2">
                    <Select
                      value={mapping[header] ?? ""}
                      onValueChange={(v) =>
                        setMapping((prev) => ({ ...prev, [header]: v ? (v as string) : null }))
                      }
                    >
                      <SelectTrigger className="w-full max-w-xs">
                        <SelectValue placeholder="(ignore)" />
                      </SelectTrigger>
                      <SelectContent>
                        {FIELD_OPTIONS.map((o) => (
                          <SelectItem key={o.value || "ignore"} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {preview.previewRows.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium uppercase text-zinc-500">Preview</h4>
            <div className="rounded-lg border border-zinc-200 bg-white overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-xs text-zinc-500">
                  <tr>
                    {previewLabels.map((label, i) => (
                      <th key={i} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.previewRows.map((row, ri) => (
                    <tr key={ri} className="border-t border-zinc-100">
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-3 py-2 text-zinc-700 whitespace-nowrap">
                          {cell || <span className="text-zinc-400">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          {!titleMapped && (
            <p className="text-xs text-amber-600">
              Map a column to &quot;Contract title&quot; to continue.
            </p>
          )}
          <Button onClick={startImport} disabled={!titleMapped || submitting}>
            {submitting ? "Starting..." : `Import ${preview.totalRows} rows`}
          </Button>
        </div>
      </div>
    )
  }

  if (step === "progress" && jobId) {
    return (
      <ImportProgressView
        jobId={jobId}
        onComplete={onJobCreated}
        onReset={reset}
      />
    )
  }

  return null
}

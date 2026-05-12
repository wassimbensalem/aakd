"use client"

import { useParams, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { ArrowLeft, GitCompare } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"

interface SnapshotMeta {
  id: string
  label: string
  createdAt: string
  createdBy: { name: string }
}

interface Hunk {
  type: "equal" | "insert" | "delete"
  lines: string[]
}

interface CompareResult {
  a: { id: string; label: string; createdAt: string }
  b: { id: string; label: string; createdAt: string }
  hunks: Hunk[]
}

export default function ComparisonPage() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()

  const contractId = params.id
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([])
  const [snapsLoading, setSnapsLoading] = useState(true)
  const [selectedA, setSelectedA] = useState(searchParams.get("a") ?? "")
  const [selectedB, setSelectedB] = useState(searchParams.get("b") ?? "live")
  const [result, setResult] = useState<CompareResult | null>(null)
  const [comparing, setComparing] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)

  // Load snapshot list
  useEffect(() => {
    fetch(`/api/contracts/${contractId}/snapshots`)
      .then((r) => r.json())
      .then((d) => { setSnapshots(d.snapshots ?? []); setSnapsLoading(false) })
      .catch(() => setSnapsLoading(false))
  }, [contractId])

  // Run comparison
  useEffect(() => {
    if (!selectedA) return
    setComparing(true)
    setCompareError(null)
    fetch(`/api/contracts/${contractId}/snapshots/compare?a=${selectedA}&b=${selectedB}`)
      .then((r) => {
        if (!r.ok) throw new Error("Comparison failed")
        return r.json()
      })
      .then((d) => { setResult(d); setComparing(false) })
      .catch((e) => { setCompareError(e.message); setComparing(false) })
  }, [contractId, selectedA, selectedB])

  const insertCount = result?.hunks.filter((h) => h.type === "insert").reduce((a, h) => a + h.lines.length, 0) ?? 0
  const deleteCount = result?.hunks.filter((h) => h.type === "delete").reduce((a, h) => a + h.lines.length, 0) ?? 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-zinc-100 px-6 py-3 flex items-center gap-4">
        <Link href={`/contracts/${contractId}`}>
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Button>
        </Link>
        <div className="flex items-center gap-2 flex-1">
          <GitCompare className="h-4 w-4 text-indigo-500" />
          <h1 className="text-sm font-semibold text-zinc-900">Version Comparison</h1>
        </div>
        {result && (
          <div className="flex gap-2 text-xs">
            <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">+{insertCount} added</Badge>
            <Badge variant="secondary" className="bg-red-50 text-red-700">−{deleteCount} removed</Badge>
          </div>
        )}
      </div>

      {/* Version selectors */}
      <div className="border-b border-zinc-100 px-6 py-3 flex items-center gap-4 bg-zinc-50">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 font-medium w-10">From</span>
          {snapsLoading ? (
            <Skeleton className="h-8 w-48" />
          ) : (
            <Select value={selectedA} onValueChange={(v) => { if (v != null) setSelectedA(v) }}>
              <SelectTrigger className="h-8 w-56 text-xs">
                <SelectValue placeholder="Select snapshot…" />
              </SelectTrigger>
              <SelectContent>
                {snapshots.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    {s.label}
                    <span className="ml-2 text-zinc-400">
                      {formatDistanceToNow(new Date(s.createdAt), { addSuffix: true })}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 font-medium w-10">To</span>
          {snapsLoading ? (
            <Skeleton className="h-8 w-48" />
          ) : (
            <Select value={selectedB} onValueChange={(v) => { if (v != null) setSelectedB(v) }}>
              <SelectTrigger className="h-8 w-56 text-xs">
                <SelectValue placeholder="Select version…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="live" className="text-xs font-medium text-indigo-600">
                  Current document (live)
                </SelectItem>
                {snapshots.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    {s.label}
                    <span className="ml-2 text-zinc-400">
                      {formatDistanceToNow(new Date(s.createdAt), { addSuffix: true })}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Diff view */}
      <div className="flex-1 overflow-auto p-6">
        {!selectedA ? (
          <div className="flex flex-col items-center justify-center h-full text-sm text-zinc-400 gap-2">
            <GitCompare className="h-10 w-10 text-zinc-200" />
            <p>Select a snapshot above to compare</p>
          </div>
        ) : comparing ? (
          <div className="space-y-2 max-w-3xl mx-auto">
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-5 w-full" />)}
          </div>
        ) : compareError ? (
          <div className="text-sm text-red-500 text-center">{compareError}</div>
        ) : result ? (
          <div className="max-w-3xl mx-auto font-mono text-xs leading-relaxed bg-white rounded-lg border border-zinc-100 overflow-hidden">
            {result.hunks.map((hunk, i) => (
              <div key={i}>
                {hunk.lines.map((line, j) => (
                  <div
                    key={j}
                    className={cn(
                      "px-4 py-0.5 whitespace-pre-wrap",
                      hunk.type === "insert" && "bg-emerald-50 text-emerald-800",
                      hunk.type === "delete" && "bg-red-50 text-red-800 line-through",
                      hunk.type === "equal" && "text-zinc-600",
                    )}
                  >
                    <span className="select-none mr-3 text-zinc-300 w-4 inline-block text-right">
                      {hunk.type === "insert" ? "+" : hunk.type === "delete" ? "−" : " "}
                    </span>
                    {line}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

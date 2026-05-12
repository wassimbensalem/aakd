"use client"

import { useEffect, useState, useCallback } from "react"
import { formatDistanceToNow } from "date-fns"
import { Camera, Trash2, GitCompare } from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"

interface Snapshot {
  id: string
  label: string
  wordCount: number
  createdAt: string
  createdBy: { name: string }
}

interface SnapshotHistoryPanelProps {
  contractId: string
  refreshTrigger?: number  // increment to force reload
}

export function SnapshotHistoryPanel({
  contractId,
  refreshTrigger = 0,
}: SnapshotHistoryPanelProps) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/contracts/${contractId}/snapshots`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setSnapshots(data.snapshots)
    } catch {
      toast.error("Failed to load snapshots")
    } finally {
      setLoading(false)
    }
  }, [contractId])

  useEffect(() => { load() }, [load, refreshTrigger])

  async function deleteSnapshot(id: string) {
    setDeleting(id)
    try {
      const res = await fetch(`/api/contracts/${contractId}/snapshots/${id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error()
      setSnapshots((prev) => prev.filter((s) => s.id !== id))
      toast.success("Snapshot deleted")
    } catch {
      toast.error("Failed to delete snapshot")
    } finally {
      setDeleting(null)
    }
  }

  if (loading) {
    return (
      <div className="p-3 space-y-2">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-md" />)}
      </div>
    )
  }

  if (snapshots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-sm text-zinc-400 gap-2">
        <Camera className="h-8 w-8 text-zinc-300" />
        <p>No snapshots yet</p>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-1">
        {snapshots.map((snap) => (
          <div
            key={snap.id}
            className="rounded-md border border-zinc-100 p-2.5 hover:border-zinc-200 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-zinc-800 truncate">{snap.label}</p>
                <p className="text-[10px] text-zinc-400 mt-0.5">
                  {formatDistanceToNow(new Date(snap.createdAt), { addSuffix: true })}
                  {" · "}
                  {snap.wordCount} words
                  {" · "}
                  {snap.createdBy.name}
                </p>
              </div>
              <div className="flex gap-0.5 shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-indigo-500 hover:bg-indigo-50"
                  title="Compare with current"
                  asChild
                >
                  <Link href={`/contracts/${contractId}/comparison?a=${snap.id}&b=live`}>
                    <GitCompare className="h-3 w-3" />
                  </Link>
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-red-400 hover:bg-red-50"
                  title="Delete snapshot"
                  disabled={deleting === snap.id}
                  onClick={() => deleteSnapshot(snap.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

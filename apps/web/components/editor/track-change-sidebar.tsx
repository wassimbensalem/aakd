"use client"

import { useEffect, useState } from "react"
import { Editor } from "@tiptap/react"
import { formatDistanceToNow } from "date-fns"
import { Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import {
  ChangeItem,
  collectChanges,
  acceptChange,
  rejectChange,
  scrollToChange,
} from "./contract-editor"

interface TrackChangeSidebarProps {
  editor: Editor
  onAcceptAll: () => void
  onRejectAll: () => void
}

export function TrackChangeSidebar({
  editor,
  onAcceptAll,
  onRejectAll,
}: TrackChangeSidebarProps) {
  const [changes, setChanges] = useState<ChangeItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  // Re-collect changes whenever the editor state updates
  useEffect(() => {
    const update = () => setChanges(collectChanges(editor))
    editor.on("update", update)
    update()
    return () => { editor.off("update", update) }
  }, [editor])

  if (changes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-sm text-zinc-400 gap-2">
        <Check className="h-8 w-8 text-zinc-300" />
        <p>No pending changes</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with bulk actions */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-100">
        <span className="text-xs font-medium text-zinc-500">
          {changes.length} change{changes.length !== 1 ? "s" : ""}
        </span>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" className="h-6 text-xs text-emerald-600" onClick={onAcceptAll}>
            Accept all
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-xs text-red-500" onClick={onRejectAll}>
            Reject all
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {changes.map((change) => (
            <div
              key={change.id}
              className={cn(
                "rounded-md border p-2 cursor-pointer transition-colors",
                activeId === change.id
                  ? "border-indigo-200 bg-indigo-50"
                  : "border-zinc-100 hover:border-zinc-200 hover:bg-zinc-50",
              )}
              onClick={() => {
                setActiveId(change.id)
                scrollToChange(editor, change)
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-[10px] h-4 px-1",
                        change.type === "insertion"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-red-50 text-red-700",
                      )}
                    >
                      {change.type === "insertion" ? "Added" : "Removed"}
                    </Badge>
                    {change.createdAt && (
                      <span className="text-[10px] text-zinc-400">
                        {formatDistanceToNow(new Date(change.createdAt), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-700 truncate">
                    {change.text || "(empty)"}
                  </p>
                </div>
                <div className="flex gap-0.5 shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-emerald-600 hover:bg-emerald-50"
                    title="Accept"
                    onClick={(e) => {
                      e.stopPropagation()
                      acceptChange(editor, change)
                    }}
                  >
                    <Check className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-red-500 hover:bg-red-50"
                    title="Reject"
                    onClick={(e) => {
                      e.stopPropagation()
                      rejectChange(editor, change)
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

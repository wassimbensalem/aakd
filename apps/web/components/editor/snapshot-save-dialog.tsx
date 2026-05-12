"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Camera } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"

interface SnapshotSaveDialogProps {
  open: boolean
  contractId: string
  content: Record<string, unknown>
  onClose: () => void
  onSaved: (snapshot: { id: string; label: string; createdAt: string }) => void
}

export function SnapshotSaveDialog({
  open,
  contractId,
  content,
  onClose,
  onSaved,
}: SnapshotSaveDialogProps) {
  const [label, setLabel] = useState("")
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!label.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/contracts/${contractId}/snapshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), content }),
      })
      if (!res.ok) throw new Error("Failed to save snapshot")
      const data = await res.json()
      toast.success("Snapshot saved")
      onSaved(data.snapshot)
      setLabel("")
      onClose()
    } catch {
      toast.error("Failed to save snapshot")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-indigo-500" />
            Save snapshot
          </DialogTitle>
          <DialogDescription>
            Capture the current state of this document for future comparison.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="snapshot-label">Label</Label>
          <Input
            id="snapshot-label"
            placeholder="e.g. Before client review"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={200}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!label.trim() || saving}>
            {saving ? "Saving…" : "Save snapshot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

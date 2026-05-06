"use client"

import { useState, useEffect } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useActiveOrganization } from "@/lib/auth/client"

export default function OrgSettingsPage() {
  const { data: activeOrg } = useActiveOrganization()
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (activeOrg?.name) setName(activeOrg.name)
  }, [activeOrg])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch("/api/org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error("Failed to update")
      toast.success("Organization updated")
    } catch {
      toast.error("Failed to update organization")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-lg">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">Organization</h1>
        <p className="text-sm text-muted-foreground">Manage your organization settings</p>
      </div>
      <form onSubmit={handleSave} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="orgName">Name</Label>
          <Input id="orgName" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>Slug</Label>
          <Input value={activeOrg?.slug ?? ""} readOnly className="bg-muted text-muted-foreground cursor-not-allowed" />
          <p className="text-xs text-muted-foreground">Slug cannot be changed after creation</p>
        </div>
        {activeOrg?.createdAt && (
          <div className="space-y-1.5">
            <Label>Created</Label>
            <p className="text-sm text-muted-foreground">{format(new Date(activeOrg.createdAt), "MMMM d, yyyy")}</p>
          </div>
        )}
        <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
      </form>
    </div>
  )
}

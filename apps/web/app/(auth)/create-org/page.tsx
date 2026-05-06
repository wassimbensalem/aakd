"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { organization } from "@/lib/auth/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function CreateOrgPage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await organization.create({
        name,
        slug: name.toLowerCase().replace(/\s+/g, "-"),
      })
      if (result.error) {
        toast.error(result.error.message ?? "Failed to create organization")
      } else {
        router.push("/dashboard")
      }
    } catch {
      toast.error("An unexpected error occurred")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-lg font-semibold">Create your organization</h1>
        <p className="text-sm text-muted-foreground">Set up your workspace to manage contracts</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Organization name</Label>
          <Input
            id="name"
            type="text"
            placeholder="Acme Corp"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          {name && (
            <p className="text-xs text-muted-foreground">
              Slug: {name.toLowerCase().replace(/\s+/g, "-")}
            </p>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={loading || !name.trim()}>
          {loading ? "Creating..." : "Create organization"}
        </Button>
      </form>
    </>
  )
}

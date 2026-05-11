"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { organization } from "@/lib/auth/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useTranslations } from "next-intl"

export default function CreateOrgPage() {
  const router = useRouter()
  const t = useTranslations("auth")
  const tc = useTranslations("common")
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
        toast.error(result.error.message ?? t("createOrgFailed"))
      } else {
        await organization.setActive({ organizationId: result.data.id })
        router.push("/dashboard")
      }
    } catch {
      toast.error(tc("error"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">{t("createOrgTitle")}</h1>
        <p className="text-sm text-zinc-500">{t("createOrgSubtitle")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">{t("orgName")}</Label>
          <Input
            id="name"
            type="text"
            placeholder="Acme Corp"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          {name && (
            <p className="text-xs text-zinc-500">
              {t("orgSlug", { slug: name.toLowerCase().replace(/\s+/g, "-") })}
            </p>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={loading || !name.trim()}>
          {loading ? t("creating") : t("createOrg")}
        </Button>
      </form>
    </>
  )
}

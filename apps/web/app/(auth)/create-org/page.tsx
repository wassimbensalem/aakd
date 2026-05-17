"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
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
        // Better Auth returns a slug-uniqueness violation when two orgs share the
        // same generated slug. Surface this as a friendly, actionable message.
        const msg = result.error.message ?? ""
        const isSlugConflict =
          msg.toLowerCase().includes("slug") ||
          msg.toLowerCase().includes("unique") ||
          msg.toLowerCase().includes("already exists") ||
          (result.error as { status?: number }).status === 409
        toast.error(
          isSlugConflict
            ? "An organisation with that name already exists. Please choose a different name."
            : msg || t("createOrgFailed"),
        )
      } else {
        await organization.setActive({ organizationId: result.data.id })
        router.push("/onboarding")
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
      <p className="mt-4 text-center text-sm text-zinc-500">
        Joining an existing team?{" "}
        <Link href="/dashboard" className="text-indigo-600 hover:underline">
          Skip — accept an invitation instead
        </Link>
      </p>
    </>
  )
}

"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { authClient } from "@/lib/auth/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useTranslations } from "next-intl"

function ResetPasswordForm() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get("token") ?? ""
  const t = useTranslations("auth")
  const tc = useTranslations("common")

  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      toast.error(t("passwordMismatch"))
      return
    }
    if (password.length < 8) {
      toast.error(t("passwordTooShort"))
      return
    }
    if (!token) {
      toast.error(t("missingToken"))
      return
    }
    setLoading(true)
    try {
      const result = await authClient.resetPassword({ newPassword: password, token })
      if (result.error) {
        toast.error(result.error.message ?? t("resetFailed"))
      } else {
        toast.success(t("passwordUpdated"))
        router.push("/login")
      }
    } catch {
      toast.error(tc("error"))
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <>
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-900">{t("invalidLinkTitle")}</h1>
          <p className="text-sm text-zinc-500">{t("invalidLinkSubtitle")}</p>
        </div>
        <Link href="/forgot-password" className="text-indigo-600 hover:underline text-sm">
          {t("requestNewLink")}
        </Link>
      </>
    )
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">{t("resetPasswordTitle")}</h1>
        <p className="text-sm text-zinc-500">{t("resetPasswordSubtitle")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="password">{t("newPassword")}</Label>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">{t("confirmPassword")}</Label>
          <Input
            id="confirm"
            type="password"
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? t("updating") : t("setNewPassword")}
        </Button>
      </form>
    </>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  )
}

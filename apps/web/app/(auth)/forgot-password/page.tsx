"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useTranslations } from "next-intl"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const t = useTranslations("auth")
  const tc = useTranslations("common")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, redirectTo: "/reset-password" }),
      })
      setSent(true)
    } catch {
      toast.error(tc("error"))
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <>
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-900">{t("checkEmailTitle")}</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {t("checkEmailSubtitle", { email })}
          </p>
        </div>
        <p className="mt-4 text-center text-sm text-zinc-500">
          <Link href="/login" className="text-indigo-600 hover:underline">
            {t("backToSignIn")}
          </Link>
        </p>
      </>
    )
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">{t("forgotPasswordTitle")}</h1>
        <p className="text-sm text-zinc-500">{t("forgotPasswordSubtitle")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">{t("email")}</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? t("sending") : t("sendResetLink")}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-zinc-500">
        <Link href="/login" className="text-indigo-600 hover:underline">
          {t("backToSignIn")}
        </Link>
      </p>
    </>
  )
}

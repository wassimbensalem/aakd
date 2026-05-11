"use client"

import { useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { signIn } from "@/lib/auth/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useTranslations } from "next-intl"

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackURL = searchParams.get("callbackURL") ?? "/dashboard"
  const t = useTranslations("auth")
  const te = useTranslations("errors")

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await signIn.email({
        email,
        password,
        callbackURL,
      })
      if (result.error) {
        toast.error(result.error.message ?? t("signInFailed"))
      } else {
        router.push(callbackURL)
      }
    } catch {
      toast.error(te("serverError"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">{t("login")}</h1>
        <p className="text-sm text-zinc-500">{t("loginSubtitle")}</p>
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
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t("password")}</Label>
            <Link href="/forgot-password" className="text-xs text-indigo-600 hover:underline">
              {t("forgotPassword")}
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? t("signingIn") : t("login")}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-zinc-500">
        {t("noAccount")}{" "}
        <Link
          href={callbackURL !== "/dashboard" ? `/register?callbackURL=${encodeURIComponent(callbackURL)}` : "/register"}
          className="text-indigo-600 hover:underline"
        >
          {t("createOne")}
        </Link>
      </p>
    </>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

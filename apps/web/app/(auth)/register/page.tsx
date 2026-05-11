"use client"

import { useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { signUp } from "@/lib/auth/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useTranslations } from "next-intl"

function RegisterForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // If the user arrived via an invitation link, callbackURL points back to
  // /accept-invitation?id=... — skip /create-org entirely and go accept.
  const callbackURL = searchParams.get("callbackURL") ?? null
  const t = useTranslations("auth")
  const te = useTranslations("errors")

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  const destination = callbackURL ?? "/create-org"

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await signUp.email({
        name,
        email,
        password,
        callbackURL: destination,
      })
      if (result.error) {
        toast.error(result.error.message ?? t("registrationFailed"))
      } else {
        router.push(destination)
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
        <h1 className="text-xl font-semibold text-zinc-900">{t("register")}</h1>
        <p className="text-sm text-zinc-500">
          {callbackURL ? t("registerSubtitleInvite") : t("registerSubtitle")}
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            type="text"
            placeholder="Jane Smith"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
          />
        </div>
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
          <Label htmlFor="password">{t("password")}</Label>
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
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? t("creatingAccount") : t("register")}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-zinc-500">
        {t("hasAccount")}{" "}
        <Link
          href={callbackURL ? `/login?callbackURL=${encodeURIComponent(callbackURL)}` : "/login"}
          className="text-indigo-600 hover:underline"
        >
          {t("login")}
        </Link>
      </p>
    </>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  )
}

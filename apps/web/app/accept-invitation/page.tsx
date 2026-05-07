"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Shield, CheckCircle, XCircle, Loader2 } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { organization, useSession } from "@/lib/auth/client"

type State = "loading" | "accepting" | "success" | "no_id" | "error"

export default function AcceptInvitationPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session, isPending: sessionLoading } = useSession()
  const [state, setState] = useState<State>("loading")
  const [errorMsg, setErrorMsg] = useState<string>("")
  const [orgName, setOrgName] = useState<string>("")

  const invitationId = searchParams.get("id")

  useEffect(() => {
    // Wait for session to resolve before doing anything
    if (sessionLoading) return

    if (!invitationId) {
      setState("no_id")
      return
    }

    // Not logged in → send to login with callbackURL pointing back here
    if (!session) {
      const callbackURL = `/accept-invitation?id=${encodeURIComponent(invitationId)}`
      router.replace(`/login?callbackURL=${encodeURIComponent(callbackURL)}`)
      return
    }

    // Logged in — auto-accept
    setState("accepting")
    organization
      .acceptInvitation({ invitationId })
      .then((result) => {
        if (result.error) {
          setErrorMsg(result.error.message ?? "Failed to accept invitation")
          setState("error")
          return
        }
        // result.data contains the new membership; grab org name if available
        const name =
          (result.data as { invitation?: { organizationName?: string } })
            ?.invitation?.organizationName ?? ""
        setOrgName(name)
        setState("success")
        // Give the user a moment to see the success message, then go to dashboard
        setTimeout(() => router.replace("/dashboard"), 1800)
      })
      .catch((err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : "An unexpected error occurred")
        setState("error")
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLoading, session, invitationId])

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-semibold tracking-tight text-zinc-900">ClauseFlow</span>
        </div>

        {/* Card */}
        <div className="rounded-lg border border-zinc-200 bg-white p-8 shadow-sm text-center">
          {(state === "loading" || state === "accepting") && (
            <>
              <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-indigo-500" />
              <h1 className="text-base font-semibold text-zinc-900">
                {state === "loading" ? "Checking session…" : "Accepting invitation…"}
              </h1>
              <p className="mt-1 text-sm text-zinc-500">Just a moment</p>
            </>
          )}

          {state === "success" && (
            <>
              <CheckCircle className="mx-auto mb-4 h-8 w-8 text-green-500" />
              <h1 className="text-base font-semibold text-zinc-900">You're in!</h1>
              <p className="mt-1 text-sm text-zinc-500">
                {orgName
                  ? `Welcome to ${orgName}. Redirecting…`
                  : "Invitation accepted. Redirecting to dashboard…"}
              </p>
            </>
          )}

          {state === "error" && (
            <>
              <XCircle className="mx-auto mb-4 h-8 w-8 text-red-500" />
              <h1 className="text-base font-semibold text-zinc-900">Invitation failed</h1>
              <p className="mt-1 text-sm text-zinc-500">{errorMsg}</p>
              <div className="mt-6 flex flex-col gap-2">
                <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full justify-center")}>
                  Go to dashboard
                </Link>
                <Link href="/login" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-full justify-center")}>
                  Sign in with a different account
                </Link>
              </div>
            </>
          )}

          {state === "no_id" && (
            <>
              <XCircle className="mx-auto mb-4 h-8 w-8 text-zinc-400" />
              <h1 className="text-base font-semibold text-zinc-900">Invalid invitation link</h1>
              <p className="mt-1 text-sm text-zinc-500">
                This link is missing the invitation token. Please use the link from your email.
              </p>
              <Link href="/login" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-6 w-full justify-center")}>
                Go to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

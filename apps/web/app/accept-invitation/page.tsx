"use client"

import { useEffect, useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Shield, CheckCircle, XCircle, Loader2 } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { organization, useSession } from "@/lib/auth/client"

type State = "loading" | "accepting" | "success" | "no_id" | "error"

function AcceptInvitationContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session, isPending: sessionLoading } = useSession()
  const [state, setState] = useState<State>("loading")
  const [errorMsg, setErrorMsg] = useState<string>("")
  const [orgName, setOrgName] = useState<string>("")

  const invitationId = searchParams.get("id")

  useEffect(() => {
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

    // Logged in — call our own accept endpoint (not Better Auth's, which
    // has quirks with manually-created invitations and returns spurious errors).
    setState("accepting")

    fetch(`/api/org/invitations/${invitationId}/accept`, { method: "POST" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))

        if (!res.ok) {
          const friendlyMessages: Record<string, string> = {
            already_accepted: "This invitation has already been accepted.",
            expired: "This invitation link has expired. Ask your admin to send a new one.",
            email_mismatch: body.message ?? "This invitation was sent to a different email address.",
          }
          setErrorMsg(friendlyMessages[body?.error] ?? body?.error ?? "Failed to accept invitation")
          setState("error")
          return
        }

        // Set the accepted org as active in the session so the app layout
        // doesn't redirect to /create-org.
        const orgId: string | undefined = body.organizationId
        if (orgId) {
          await organization.setActive({ organizationId: orgId }).catch(() => {})

          // Fetch org name to show in the success message
          const orgRes = await fetch(`/api/org`).catch(() => null)
          if (orgRes?.ok) {
            const orgData = await orgRes.json().catch(() => ({}))
            setOrgName(orgData?.name ?? "")
          }
        }

        setState("success")
        setTimeout(() => router.replace("/dashboard"), 1800)
      })
      .catch(() => {
        setErrorMsg("An unexpected error occurred")
        setState("error")
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLoading, session, invitationId])

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-semibold tracking-tight text-zinc-900">Aaked</span>
        </div>

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
              <h1 className="text-base font-semibold text-zinc-900">You&apos;re in!</h1>
              <p className="mt-1 text-sm text-zinc-500">
                {orgName ? `Welcome to ${orgName}. Redirecting…` : "Invitation accepted. Redirecting to dashboard…"}
              </p>
            </>
          )}

          {state === "error" && (
            <>
              <XCircle className="mx-auto mb-4 h-8 w-8 text-red-500" />
              <h1 className="text-base font-semibold text-zinc-900">Couldn&apos;t accept invitation</h1>
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

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
      </div>
    }>
      <AcceptInvitationContent />
    </Suspense>
  )
}

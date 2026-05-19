"use client"

import { useState, useEffect } from "react"
import posthog from "posthog-js"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function CookieConsent() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const consent = localStorage.getItem("cookie_consent")
    if (!consent) setVisible(true)
  }, [])

  function accept() {
    localStorage.setItem("cookie_consent", "accepted")
    posthog.opt_in_capturing()
    setVisible(false)
  }

  function decline() {
    localStorage.setItem("cookie_consent", "declined")
    posthog.opt_out_capturing()
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      className={cn(
        "fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-lg",
        "rounded-xl border bg-background/95 backdrop-blur-sm shadow-lg p-4",
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4",
      )}
    >
      <p className="text-sm text-muted-foreground flex-1">
        We use cookies to understand how you use Aakd and improve your experience.{" "}
        <a
          href="/privacy"
          className="underline underline-offset-2 hover:text-foreground transition-colors"
          target="_blank"
          rel="noopener noreferrer"
        >
          Privacy Policy
        </a>
      </p>
      <div className="flex gap-2 shrink-0">
        <Button variant="outline" size="sm" onClick={decline}>
          Decline
        </Button>
        <Button size="sm" onClick={accept}>
          Accept
        </Button>
      </div>
    </div>
  )
}

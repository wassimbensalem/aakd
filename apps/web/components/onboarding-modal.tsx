"use client"

import { useEffect, useState } from "react"
import { Sparkles, FileText, Plug, Users } from "lucide-react"

interface Step {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}

const STEPS: Step[] = [
  {
    icon: Sparkles,
    title: "Welcome to ClauseFlow",
    description:
      "Let's set up your workspace. This only takes a minute.",
  },
  {
    icon: FileText,
    title: "Create your first contract",
    description:
      "Start from scratch, use a template, or create with AI assistance.",
  },
  {
    icon: Plug,
    title: "Connect your tools",
    description:
      "Link your CRM, e-signature, and storage providers.",
  },
  {
    icon: Users,
    title: "Invite your team",
    description:
      "Add team members and assign roles to collaborate effectively.",
  },
]

const STORAGE_KEY = "cf_onboarding_done"

export function OnboardingModal() {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (typeof window !== "undefined") {
      const done = localStorage.getItem(STORAGE_KEY)
      if (!done) {
        setVisible(true)
      }
    }
  }, [])

  function close() {
    localStorage.setItem(STORAGE_KEY, "1")
    setVisible(false)
  }

  function next() {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1)
    } else {
      close()
    }
  }

  if (!visible) return null

  const current = STEPS[step]
  const Icon = current.icon
  const isLast = step === STEPS.length - 1

  return (
    <div className="fixed inset-0 bg-black/50 z-[9992] flex items-center justify-center">
      <div className="w-[480px] rounded-xl bg-card border border-border shadow-2xl overflow-hidden">
        {/* Top section */}
        <div className="p-8 pb-6 text-center">
          <div className="w-14 h-14 rounded-xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
            <Icon className="h-7 w-7" />
          </div>
          <p className="text-xl font-bold mb-2">{current.title}</p>
          <p className="text-[14px] text-muted-foreground leading-relaxed">
            {current.description}
          </p>

          {/* Step dots */}
          <div className="flex justify-center gap-1.5 mt-5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={
                  i === step
                    ? "w-5 h-1.5 rounded-full bg-primary transition-all"
                    : "w-1.5 h-1.5 rounded-full bg-muted transition-all"
                }
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 pb-6 flex justify-between">
          <button
            type="button"
            onClick={close}
            className="inline-flex items-center h-8 px-3 text-sm font-medium rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={next}
            className="inline-flex items-center h-8 px-4 text-sm font-medium rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90"
          >
            {isLast ? "Get Started" : "Next"}
          </button>
        </div>
      </div>
    </div>
  )
}

export default OnboardingModal

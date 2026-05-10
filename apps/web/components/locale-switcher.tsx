"use client"

import { useState, useTransition } from "react"
import { useLocale } from "next-intl"
import { toast } from "sonner"
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/config"
import { cn } from "@/lib/utils"

interface LocaleSwitcherProps {
  className?: string
}

export function LocaleSwitcher({ className }: LocaleSwitcherProps) {
  const currentLocale = useLocale() as Locale
  const [value, setValue] = useState<Locale>(currentLocale)
  const [pending, startTransition] = useTransition()

  function onChange(next: Locale) {
    if (next === value) return
    setValue(next)
    startTransition(async () => {
      try {
        const res = await fetch("/api/user/locale", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale: next }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        toast.success("Language updated")
        window.location.reload()
      } catch {
        setValue(currentLocale)
        toast.error("Failed to update language")
      }
    })
  }

  return (
    <select
      aria-label="Language"
      value={value}
      disabled={pending}
      onChange={(e) => onChange(e.target.value as Locale)}
      className={cn(
        "h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm",
        "focus:outline-none focus:ring-2 focus:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      {LOCALES.map((loc) => (
        <option key={loc} value={loc}>
          {LOCALE_LABELS[loc].flag} {LOCALE_LABELS[loc].name}
        </option>
      ))}
    </select>
  )
}

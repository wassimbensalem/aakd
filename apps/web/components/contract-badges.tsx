"use client"

import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { ContractStatus, ContractType } from "@/lib/types"

const STATUS_CLASS: Record<ContractStatus, string> = {
  ACTIVE:             "bg-emerald-100 text-emerald-700",
  DRAFT:              "bg-muted text-foreground/70",
  INTERNAL_REVIEW:    "bg-blue-100 text-blue-700",
  PENDING_APPROVAL:   "bg-amber-100 text-amber-700",
  AWAITING_SIGNATURE: "bg-violet-100 text-violet-700",
  EXPIRED:            "bg-red-100 text-red-700",
  TERMINATED:         "bg-red-200 text-red-800",
  ARCHIVED:           "border border-border bg-transparent text-muted-foreground",
}

const TYPE_CLASS: Record<ContractType, string> = {
  NDA:        "bg-primary/10 text-primary",
  MSA:        "bg-violet-100 text-violet-700",
  SOW:        "bg-cyan-100 text-cyan-700",
  EMPLOYMENT: "bg-emerald-100 text-emerald-700",
  VENDOR:     "bg-orange-100 text-orange-700",
  CUSTOMER:   "bg-pink-100 text-pink-700",
  OTHER:      "bg-muted text-foreground/70",
}

export function StatusBadge({ status }: { status: ContractStatus }) {
  const t = useTranslations("contract.statuses")
  const className = STATUS_CLASS[status] ?? "bg-muted text-foreground/70"
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {t(status)}
    </span>
  )
}

export function TypeBadge({ type }: { type: ContractType | null | undefined }) {
  const t = useTranslations("contract.types")
  if (!type) return null
  const className = TYPE_CLASS[type] ?? "bg-muted text-foreground/70"
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {t(type)}
    </span>
  )
}

export function DaysRemainingBadge({ days }: { days: number }) {
  const t = useTranslations("contract.statuses")
  const className =
    days <= 0
      ? "bg-red-100 text-red-700"
      : days <= 7
        ? "bg-red-100 text-red-700"
        : days <= 30
          ? "bg-amber-100 text-amber-700"
          : "bg-muted text-foreground/70"

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
        className,
      )}
    >
      {days <= 0 ? t("EXPIRED") : `${days}d`}
    </span>
  )
}

"use client"

import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { ContractStatus } from "@/lib/types"

const STATUS_CLASS: Record<ContractStatus, string> = {
  ACTIVE:             "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0",
  DRAFT:              "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-0",
  INTERNAL_REVIEW:    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0",
  PENDING_APPROVAL:   "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0",
  AWAITING_SIGNATURE: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 border-0",
  EXPIRED:            "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0",
  TERMINATED:         "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0",
  ARCHIVED:           "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500 border-0",
}

export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  const t = useTranslations("contract.statuses")
  const className = STATUS_CLASS[status] ?? "bg-zinc-100 text-zinc-600 border-0"
  return (
    <Badge className={className}>
      {t(status)}
    </Badge>
  )
}

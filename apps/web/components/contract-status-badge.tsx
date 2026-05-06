"use client"

import { Badge } from "@/components/ui/badge"
import { ContractStatus } from "@/lib/types"

const statusConfig: Record<ContractStatus, { label: string; className: string }> = {
  ACTIVE: { label: "Active", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0" },
  DRAFT: { label: "Draft", className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-0" },
  INTERNAL_REVIEW: { label: "Internal Review", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0" },
  PENDING_APPROVAL: { label: "Pending Approval", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0" },
  AWAITING_SIGNATURE: { label: "Awaiting Signature", className: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 border-0" },
  EXPIRED: { label: "Expired", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0" },
  TERMINATED: { label: "Terminated", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0" },
  ARCHIVED: { label: "Archived", className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500 border-0" },
}

export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  const config = statusConfig[status] ?? { label: status, className: "bg-zinc-100 text-zinc-600 border-0" }
  return (
    <Badge className={config.className}>
      {config.label}
    </Badge>
  )
}

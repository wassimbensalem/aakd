import { cn } from "@/lib/utils"
import { ContractStatus, ContractType } from "@/lib/types"

const statusConfig: Record<ContractStatus, { label: string; dot: string }> = {
  ACTIVE:              { label: "Active",             dot: "bg-emerald-500" },
  DRAFT:               { label: "Draft",              dot: "bg-zinc-400" },
  INTERNAL_REVIEW:     { label: "Internal Review",    dot: "bg-blue-500" },
  PENDING_APPROVAL:    { label: "Pending Approval",   dot: "bg-amber-500" },
  AWAITING_SIGNATURE:  { label: "Awaiting Signature", dot: "bg-violet-500" },
  EXPIRED:             { label: "Expired",            dot: "bg-red-500" },
  TERMINATED:          { label: "Terminated",         dot: "bg-red-600" },
  ARCHIVED:            { label: "Archived",           dot: "bg-zinc-300" },
}

const typeLabels: Record<ContractType, string> = {
  NDA:        "NDA",
  MSA:        "MSA",
  SOW:        "SOW",
  EMPLOYMENT: "Employment",
  VENDOR:     "Vendor",
  CUSTOMER:   "Customer",
  OTHER:      "Other",
}

export function StatusBadge({ status }: { status: ContractStatus }) {
  const config = statusConfig[status] ?? { label: status, dot: "bg-zinc-400" }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block size-1.5 rounded-full", config.dot)} />
      <span className="text-sm text-foreground">{config.label}</span>
    </span>
  )
}

export function TypeBadge({ type }: { type: ContractType | null | undefined }) {
  if (!type) return null
  return (
    <span className="inline-flex items-center rounded bg-secondary px-2 py-0.5 text-xs font-medium text-foreground">
      {typeLabels[type] ?? type}
    </span>
  )
}

export function DaysRemainingBadge({ days }: { days: number }) {
  const color =
    days <= 0
      ? "text-red-600 dark:text-red-400"
      : days <= 7
        ? "text-red-600 dark:text-red-400"
        : days <= 30
          ? "text-amber-600 dark:text-amber-400"
          : "text-emerald-600 dark:text-emerald-400"

  return (
    <span className={cn("shrink-0 text-xs tabular-nums font-medium", color)}>
      {days <= 0 ? "Expired" : `${days}d`}
    </span>
  )
}

import { cn } from "@/lib/utils"
import { ContractStatus, ContractType } from "@/lib/types"

const statusConfig: Record<ContractStatus, { label: string; className: string }> = {
  ACTIVE:              { label: "Active",             className: "bg-emerald-100 text-emerald-700" },
  DRAFT:               { label: "Draft",              className: "bg-muted text-foreground/70" },
  INTERNAL_REVIEW:     { label: "Internal Review",    className: "bg-blue-100 text-blue-700" },
  PENDING_APPROVAL:    { label: "Pending Approval",   className: "bg-amber-100 text-amber-700" },
  AWAITING_SIGNATURE:  { label: "Awaiting Signature", className: "bg-violet-100 text-violet-700" },
  EXPIRED:             { label: "Expired",            className: "bg-red-100 text-red-700" },
  TERMINATED:          { label: "Terminated",         className: "bg-red-200 text-red-800" },
  ARCHIVED:            { label: "Archived",           className: "border border-border bg-transparent text-muted-foreground" },
}

const typeConfig: Record<ContractType, { label: string; className: string }> = {
  NDA:        { label: "NDA",        className: "bg-primary/10 text-primary" },
  MSA:        { label: "MSA",        className: "bg-violet-100 text-violet-700" },
  SOW:        { label: "SOW",        className: "bg-cyan-100 text-cyan-700" },
  EMPLOYMENT: { label: "Employment", className: "bg-emerald-100 text-emerald-700" },
  VENDOR:     { label: "Vendor",     className: "bg-orange-100 text-orange-700" },
  CUSTOMER:   { label: "Customer",   className: "bg-pink-100 text-pink-700" },
  OTHER:      { label: "Other",      className: "bg-muted text-foreground/70" },
}

export function StatusBadge({ status }: { status: ContractStatus }) {
  const config = statusConfig[status] ?? { label: status, className: "bg-muted text-foreground/70" }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        config.className,
      )}
    >
      {config.label}
    </span>
  )
}

export function TypeBadge({ type }: { type: ContractType | null | undefined }) {
  if (!type) return null
  const config = typeConfig[type] ?? { label: type, className: "bg-muted text-foreground/70" }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        config.className,
      )}
    >
      {config.label}
    </span>
  )
}

export function DaysRemainingBadge({ days }: { days: number }) {
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
      {days <= 0 ? "Expired" : `${days}d`}
    </span>
  )
}

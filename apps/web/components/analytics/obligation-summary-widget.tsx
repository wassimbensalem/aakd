"use client"

import { cn } from "@/lib/utils"

type Datum = { overdue: number; dueSoon: number }

export function ObligationSummaryWidget({ data }: { data: Datum }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-lg border border-border bg-background p-4 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Overdue</p>
        <p
          className={cn(
            "mt-1.5 text-3xl font-bold tabular-nums",
            data.overdue > 0 ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {data.overdue}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">obligations</p>
      </div>

      <div className="rounded-lg border border-border bg-background p-4 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Due Soon</p>
        <p
          className={cn(
            "mt-1.5 text-3xl font-bold tabular-nums",
            data.dueSoon > 0 ? "text-warning" : "text-muted-foreground",
          )}
        >
          {data.dueSoon}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">7 days</p>
      </div>
    </div>
  )
}

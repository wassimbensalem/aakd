"use client"

type Datum = {
  totalRequested: number
  approved: number
  rejected: number
  pending: number
}

function pct(n: number, total: number): string {
  if (total === 0) return "0.0"
  return ((n / total) * 100).toFixed(1)
}

export function ApprovalFunnelWidget({ data }: { data: Datum }) {
  if (data.totalRequested === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No approvals have been requested yet.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-background p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Requested</p>
          <p className="mt-1.5 text-3xl font-semibold tabular-nums">{data.totalRequested}</p>
        </div>

        <div className="rounded-lg border border-border bg-background p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Approved</p>
          <p className="mt-1.5 text-3xl font-semibold tabular-nums">{data.approved}</p>
          <p className="mt-1 text-xs text-primary font-medium">
            {pct(data.approved, data.totalRequested)}% rate
          </p>
        </div>

        <div className="rounded-lg border border-border bg-background p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rejected</p>
          <p className="mt-1.5 text-3xl font-semibold tabular-nums">{data.rejected}</p>
          <p className="mt-1 text-xs text-destructive font-medium">
            {pct(data.rejected, data.totalRequested)}% rate
          </p>
        </div>
      </div>

      {data.pending > 0 && (
        <p className="text-xs text-muted-foreground">
          {data.pending} pending decision
        </p>
      )}
    </div>
  )
}

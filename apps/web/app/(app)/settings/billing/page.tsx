import Link from "next/link"
import { CreditCard } from "lucide-react"

// ─── Usage bar ────────────────────────────────────────────────────────────

function UsageBar({
  label,
  used,
  max,
  displayUsed,
  displayMax,
}: {
  label: string
  used: number
  max: number
  displayUsed: string
  displayMax: string
}) {
  const pct = max > 0 ? Math.min((used / max) * 100, 100) : 0
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          {displayUsed} / {displayMax}
        </span>
      </div>
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function BillingPage() {
  return (
    <div className="flex flex-col h-full">
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-7 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-xl font-semibold">Billing</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your subscription and usage.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-5 space-y-5 max-w-2xl">
        {/* ── Preview card (grayed out) ─────────────────────────────── */}
        <div className="opacity-50 pointer-events-none rounded-[var(--radius)] border border-dashed border-border bg-card p-5 space-y-5">
          {/* Current plan */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Current Plan</h3>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  —
                </span>
                <span className="text-xs text-muted-foreground">— seats</span>
                <span className="text-sm font-bold tabular-nums">—</span>
              </div>
            </div>
          </div>

          {/* Usage */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Usage
            </p>
            <UsageBar
              label="Contracts"
              used={0}
              max={1}
              displayUsed="—"
              displayMax="∞"
            />
            <UsageBar
              label="Templates"
              used={0}
              max={1}
              displayUsed="—"
              displayMax="∞"
            />
            <UsageBar
              label="Team Members"
              used={0}
              max={1}
              displayUsed="—"
              displayMax="∞"
            />
            <UsageBar
              label="Storage"
              used={0}
              max={1}
              displayUsed="—"
              displayMax="∞"
            />
          </div>

          {/* Payment method */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-2">
              Payment Method
            </p>
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-10 items-center justify-center rounded border border-border bg-muted">
                <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <span className="text-sm text-foreground/80">
                No payment method
              </span>
            </div>
          </div>

          {/* Invoice history stub */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-2">
              Invoice History
            </p>
            <div className="rounded-[var(--radius)] border border-border overflow-hidden">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-muted border-b border-border">
                    {["Date", "Amount", "Status", ""].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground text-xs">
                      No invoices
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ── Cloud banner ──────────────────────────────────────────── */}
        <div className="flex items-start gap-4 rounded-[var(--radius)] border border-primary/20 bg-primary/5 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CreditCard className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">
              Billing — Cloud Feature
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Aakd is open-source and self-hosted. Billing management is available
              in the hosted cloud version at aakd.io.
            </p>
          </div>
          <div className="shrink-0 flex gap-2">
            <Link
              href="https://aakd.io"
              target="_blank"
              className="inline-flex items-center h-8 px-3 text-xs font-medium rounded-[var(--radius)] bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Learn More
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center h-8 px-3 text-xs font-medium rounded-[var(--radius)] border border-border text-foreground hover:bg-muted transition-colors"
            >
              Self-Hosting Guide
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

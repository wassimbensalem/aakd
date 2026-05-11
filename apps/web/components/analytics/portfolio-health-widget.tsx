"use client"

import { useTranslations } from "next-intl"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"
import type { ContractStatus } from "@/lib/types"

// Canopy-aligned status colors (hsl literals matching the design system)
const STATUS_COLORS: Record<string, string> = {
  DRAFT:               "hsl(215, 10%, 72%)",   // muted gray
  INTERNAL_REVIEW:     "hsl(200, 98%, 39%)",   // --info  (blue)
  PENDING_APPROVAL:    "hsl(38, 92%, 50%)",    // --warning (amber)
  AWAITING_SIGNATURE:  "hsl(38, 75%, 44%)",    // darker amber
  ACTIVE:              "hsl(148, 58%, 30%)",   // --primary (forest green)
  EXPIRED:             "hsl(0, 84%, 60%)",     // --destructive (red)
  TERMINATED:          "hsl(0, 74%, 46%)",     // dark red
  ARCHIVED:            "hsl(215, 10%, 82%)",   // light muted
}

const FALLBACK_COLOR = "hsl(215, 10%, 72%)"

type Datum = { status: string; count: number }

export function PortfolioHealthWidget({ data }: { data: Datum[] }) {
  const t = useTranslations("contract.statuses")
  const filtered = data.filter((d) => d.count > 0)
  const total = filtered.reduce((sum, d) => sum + d.count, 0)

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        No contracts in the portfolio yet.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="relative h-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={filtered}
              dataKey="count"
              nameKey="status"
              cx="50%"
              cy="50%"
              innerRadius={48}
              outerRadius={75}
              paddingAngle={1}
              isAnimationActive={false}
            >
              {filtered.map((d) => (
                <Cell key={d.status} fill={STATUS_COLORS[d.status] ?? FALLBACK_COLOR} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, _name, item) => {
                const payload = (item as { payload?: { status?: string } } | undefined)?.payload
                const status = (payload?.status ?? "") as ContractStatus
                const label = status in STATUS_COLORS ? t(status) : status
                return [Number(value), label]
              }}
              contentStyle={{ fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="text-3xl font-bold tabular-nums">{total}</p>
          <p className="text-xs text-muted-foreground">contracts</p>
        </div>
      </div>

      <ul className="space-y-1 text-xs">
        {filtered.map((d) => (
          <li key={d.status} className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: STATUS_COLORS[d.status] ?? FALLBACK_COLOR }}
              />
              <span className="text-foreground">{d.status in STATUS_COLORS ? t(d.status as ContractStatus) : d.status}</span>
            </span>
            <span className="tabular-nums text-muted-foreground">{d.count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

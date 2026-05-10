"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"

// Canopy tokens as literal hsl() values for Recharts SVG attrs
const C_PRIMARY   = "hsl(148, 58%, 30%)"  // --primary
const C_BORDER    = "hsl(215, 10%, 90%)"  // --border
const C_CURSOR_BG = "hsl(148 58% 30% / 0.07)"

const MONTH_ABBREV = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

type Datum = { month: string; count: number }

function parseMonth(key: string): { abbrev: string; full: string } {
  const [yearStr, monthStr] = key.split("-")
  const monthIdx = parseInt(monthStr, 10) - 1
  const abbrev = MONTH_ABBREV[monthIdx] ?? key
  const full = `${MONTH_ABBREV[monthIdx] ?? ""} ${yearStr}`.trim()
  return { abbrev, full }
}

export function MonthlyVolumeWidget({ data }: { data: Datum[] }) {
  const total = data.reduce((sum, d) => sum + d.count, 0)
  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        No contracts created in the last 12 months.
      </p>
    )
  }

  const chartData = data.map((d) => {
    const { abbrev, full } = parseMonth(d.month)
    return { month: abbrev, fullMonth: full, count: d.count }
  })

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C_BORDER} vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: C_BORDER }}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: C_BORDER }}
            width={32}
          />
          <Tooltip
            cursor={{ fill: C_CURSOR_BG }}
            contentStyle={{ fontSize: 12 }}
            formatter={(value) => [`${Number(value)} contracts`, "Volume"]}
            labelFormatter={(_label, payload) => {
              const item = payload?.[0]?.payload as { fullMonth?: string } | undefined
              return item?.fullMonth ?? ""
            }}
          />
          <Bar dataKey="count" fill={C_PRIMARY} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

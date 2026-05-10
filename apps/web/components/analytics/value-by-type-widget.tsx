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

// Canopy tokens as hsl() literals for Recharts SVG attrs
const C_PRIMARY   = "hsl(148, 58%, 30%)"  // --primary (forest green)
const C_BORDER    = "hsl(215, 10%, 90%)"  // --border
const C_CURSOR_BG = "hsl(148 58% 30% / 0.07)"

const TYPE_LABELS: Record<string, string> = {
  NDA:        "NDA",
  MSA:        "MSA",
  SOW:        "SOW",
  EMPLOYMENT: "Employment",
  VENDOR:     "Vendor",
  CUSTOMER:   "Customer",
  OTHER:      "Other",
}

type Datum = { contractType: string; totalValue: number; count: number }

function formatValue(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}

export function ValueByTypeWidget({ data }: { data: Datum[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        No contracts with a value set.
      </p>
    )
  }

  const sorted = [...data].sort((a, b) => b.totalValue - a.totalValue)
  const chartData = sorted.map((d) => ({
    type: TYPE_LABELS[d.contractType] ?? d.contractType,
    rawType: d.contractType,
    totalValue: d.totalValue,
    count: d.count,
  }))

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 8, right: 16, bottom: 4, left: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={C_BORDER} horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: C_BORDER }}
            tickFormatter={(v: number) => formatValue(v)}
          />
          <YAxis
            type="category"
            dataKey="type"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: C_BORDER }}
            width={80}
          />
          <Tooltip
            cursor={{ fill: C_CURSOR_BG }}
            contentStyle={{ fontSize: 12 }}
            formatter={(value, _name, item) => {
              const payload = (item as { payload?: { count?: number } } | undefined)?.payload
              const count = payload?.count ?? 0
              const numValue = Number(value)
              return [`${formatValue(numValue)} across ${count} contract${count === 1 ? "" : "s"}`, "Total"]
            }}
            labelFormatter={(label) => String(label ?? "")}
          />
          <Bar dataKey="totalValue" fill={C_PRIMARY} radius={[0, 4, 4, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

"use client"

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts"

const STATUS_COLORS: Record<string, string> = {
  ACTIVE:           "hsl(148, 58%, 30%)",
  DRAFT:            "hsl(215, 10%, 72%)",
  PENDING_APPROVAL: "hsl(38, 92%, 50%)",
  EXPIRED:          "hsl(0, 84%, 60%)",
  INTERNAL_REVIEW:  "hsl(200, 98%, 39%)",
  ARCHIVED:         "hsl(215, 10%, 85%)",
}

const DEFAULT_COLOR = "hsl(215, 10%, 80%)"

type Datum = { status: string; count: number }

export function StatusDonutWidget({ data }: { data: Datum[] }) {
  const total = data.reduce((s, d) => s + d.count, 0)

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        No contract data yet.
      </p>
    )
  }

  const chartData = data.map((d) => ({
    name: d.status.replace("_", " "),
    key: d.status,
    value: d.count,
  }))

  return (
    <div className="flex items-center gap-6">
      {/* Donut */}
      <div className="shrink-0 w-[160px] h-[160px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={75}
              dataKey="value"
              strokeWidth={2}
              stroke="hsl(0 0% 100%)"
              isAnimationActive={false}
            >
              {chartData.map((entry, idx) => (
                <Cell
                  key={idx}
                  fill={STATUS_COLORS[entry.key] ?? DEFAULT_COLOR}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              formatter={(value, name) => [value, name]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
        {chartData.map((d) => {
          const pct = total > 0 ? Math.round((d.value / total) * 100) : 0
          return (
            <div key={d.key} className="flex items-center gap-2 text-xs">
              <span
                className="shrink-0 w-2.5 h-2.5 rounded-sm"
                style={{ background: STATUS_COLORS[d.key] ?? DEFAULT_COLOR }}
              />
              <span className="flex-1 truncate text-foreground/80">{d.name}</span>
              <span className="tabular-nums font-medium text-foreground">
                {d.value}
              </span>
              <span className="tabular-nums text-muted-foreground w-7 text-right">
                {pct}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

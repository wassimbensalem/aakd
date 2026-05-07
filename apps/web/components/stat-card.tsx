import { cn } from "@/lib/utils"

interface StatCardProps {
  title: string
  value: number | string
  subtitle?: string
  className?: string
}

export function StatCard({ title, value, subtitle, className }: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-4",
        className,
      )}
    >
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </p>
      {subtitle && (
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      )}
    </div>
  )
}

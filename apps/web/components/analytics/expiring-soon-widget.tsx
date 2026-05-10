"use client"

import Link from "next/link"
import { ContractTypeBadge } from "@/components/contract-type-badge"
import { ContractType } from "@/lib/types"
import { cn } from "@/lib/utils"

type ExpiringSoonData = {
  next30: number
  next60: number
  next90: number
  contracts: Array<{
    id: string
    title: string
    endDate: string
    counterpartyName: string | null
    contractType: string | null
    daysUntilExpiry: number
  }>
}

function smallestNonZero(values: number[]): number | null {
  const nonZero = values.filter((v) => v > 0)
  if (nonZero.length === 0) return null
  return Math.min(...nonZero)
}

function formatDate(iso: string): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function ExpiringSoonWidget({ data }: { data: ExpiringSoonData }) {
  const highlight = smallestNonZero([data.next30, data.next60, data.next90])

  const StatNumber = ({ value, label }: { value: number; label: string }) => (
    <div>
      <p
        className={cn(
          "text-2xl font-bold tabular-nums",
          value > 0 && value === highlight ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <StatNumber value={data.next30} label="30 days" />
        <StatNumber value={data.next60} label="60 days" />
        <StatNumber value={data.next90} label="90 days" />
      </div>

      {data.contracts.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No contracts expiring in the next 90 days.
        </p>
      ) : (
        <div className="overflow-x-auto -mx-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left px-3 py-2 font-medium">Contract</th>
                <th className="text-left px-2 py-2 font-medium">Counterparty</th>
                <th className="text-left px-2 py-2 font-medium">Type</th>
                <th className="text-left px-2 py-2 font-medium">Expires</th>
                <th className="text-right px-3 py-2 font-medium">Days</th>
              </tr>
            </thead>
            <tbody>
              {data.contracts.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <Link
                      href={`/contracts/${c.id}`}
                      className="font-medium hover:text-primary transition-colors line-clamp-1"
                    >
                      {c.title}
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-muted-foreground line-clamp-1">
                    {c.counterpartyName ?? "—"}
                  </td>
                  <td className="px-2 py-2">
                    <ContractTypeBadge type={c.contractType as ContractType | null} />
                  </td>
                  <td className="px-2 py-2 text-muted-foreground whitespace-nowrap">
                    {formatDate(c.endDate)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right tabular-nums whitespace-nowrap",
                      c.daysUntilExpiry <= 30 ? "text-destructive font-medium" : "text-muted-foreground",
                    )}
                  >
                    {c.daysUntilExpiry}d
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

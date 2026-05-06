"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Plus, Search, ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { ContractStatusBadge } from "@/components/contract-status-badge"
import { ContractTypeBadge } from "@/components/contract-type-badge"
import { Contract, ContractStatus, ContractType } from "@/lib/types"
import { format, differenceInDays } from "date-fns"

const CONTRACT_STATUSES: ContractStatus[] = [
  "DRAFT", "INTERNAL_REVIEW", "PENDING_APPROVAL", "AWAITING_SIGNATURE",
  "ACTIVE", "EXPIRED", "TERMINATED", "ARCHIVED",
]

const CONTRACT_TYPES: ContractType[] = [
  "NDA", "MSA", "SOW", "EMPLOYMENT", "VENDOR", "CUSTOMER", "OTHER",
]

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function formatCurrency(value: number, currency: string = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0 }).format(value)
}

export default function ContractsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const pageSize = 20

  const [search, setSearch] = useState(searchParams.get("search") ?? "")
  const [statusFilter, setStatusFilter] = useState<string>(searchParams.get("status") ?? "")
  const [typeFilter, setTypeFilter] = useState<string>(searchParams.get("type") ?? "")
  const debouncedSearch = useDebounce(search, 300)

  const fetchContracts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (debouncedSearch) params.set("search", debouncedSearch)
      if (statusFilter) params.set("status", statusFilter)
      if (typeFilter) params.set("contractType", typeFilter)
      params.set("limit", String(pageSize))
      params.set("offset", String((page - 1) * pageSize))

      const res = await fetch(`/api/contracts?${params}`)
      if (!res.ok) throw new Error("Failed to fetch")
      const data = await res.json()
      setContracts(data.contracts ?? data ?? [])
      setTotal(data.total ?? (data.contracts ?? data ?? []).length)
    } catch {
      toast.error("Failed to load contracts")
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, statusFilter, typeFilter, page])

  useEffect(() => { fetchContracts() }, [fetchContracts])

  async function archiveContract(id: string) {
    try {
      await fetch(`/api/contracts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ARCHIVED" }),
      })
      toast.success("Contract archived")
      fetchContracts()
    } catch {
      toast.error("Failed to archive contract")
    }
  }

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Contracts</h1>
        <Link href="/contracts/new" className="inline-flex items-center gap-1 h-7 px-2.5 text-[0.8rem] font-medium rounded-[min(var(--radius-md),12px)] bg-primary text-primary-foreground transition-colors hover:opacity-90">
          <Plus className="h-3.5 w-3.5" />
          New Contract
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search contracts..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="pl-8 w-64"
          />
        </div>
        <Select
          value={statusFilter || "all"}
          onValueChange={(v) => { setStatusFilter(v == null || v === "all" ? "" : v); setPage(1) }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {CONTRACT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={typeFilter || "all"}
          onValueChange={(v) => { setTypeFilter(v == null || v === "all" ? "" : v); setPage(1) }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {CONTRACT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Title</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Type</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Counterparty</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Value</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">End Date</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Owner</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : contracts.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                  No contracts found.{" "}
                  <Link href="/contracts/new" className="text-primary hover:underline">
                    Create one
                  </Link>
                </td>
              </tr>
            ) : (
              contracts.map((c) => {
                const daysToEnd = c.endDate
                  ? differenceInDays(new Date(c.endDate), new Date())
                  : null
                return (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/contracts/${c.id}`} className="font-medium hover:text-primary transition-colors line-clamp-1">
                        {c.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <ContractTypeBadge type={c.contractType} />
                    </td>
                    <td className="px-4 py-3">
                      <ContractStatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c.counterpartyName ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.value != null ? formatCurrency(c.value, c.currency ?? "USD") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {c.endDate ? (
                        <span className={daysToEnd !== null && daysToEnd < 30 ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}>
                          {format(new Date(c.endDate), "MMM d, yyyy")}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.owner?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => router.push(`/contracts/${c.id}`)}>
                            View
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => router.push(`/contracts/${c.id}?edit=true`)}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => archiveContract(c.id)}
                          >
                            Archive
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {total} contract{total !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPage((p) => p - 1)} disabled={page === 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm px-2">{page} / {totalPages}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPage((p) => p + 1)} disabled={page === totalPages}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

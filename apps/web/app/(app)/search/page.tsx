"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Search, FileText } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TypeBadge, StatusBadge } from "@/components/contract-badges"
import { ContractStatus, ContractType } from "@/lib/types"
import { cn } from "@/lib/utils"

interface SearchResult {
  id: string
  title: string
  contractType: ContractType | null
  status: ContractStatus
  counterpartyName: string | null
  value: number | null
  currency: string | null
  endDate: string | null
  createdAt: string
}

const CONTRACT_TYPES: ContractType[] = ["NDA", "MSA", "SOW", "EMPLOYMENT", "VENDOR", "CUSTOMER", "OTHER"]
const STATUS_OPTIONS: ContractStatus[] = ["ACTIVE", "DRAFT", "EXPIRED", "ARCHIVED"]

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export default function SearchPage() {
  const router = useRouter()

  const [query, setQuery] = useState(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("q") ?? ""
    }
    return ""
  })
  const debouncedQuery = useDebounce(query, 300)

  const [selectedTypes, setSelectedTypes] = useState<Set<ContractType>>(new Set())
  const [selectedStatuses, setSelectedStatuses] = useState<Set<ContractStatus>>(new Set())
  const [endDateFrom, setEndDateFrom] = useState("")
  const [endDateTo, setEndDateTo] = useState("")
  const [valueMin, setValueMin] = useState("")
  const [valueMax, setValueMax] = useState("")

  const [results, setResults] = useState<SearchResult[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const hasFilters = selectedTypes.size > 0 || selectedStatuses.size > 0 || endDateFrom || endDateTo || valueMin || valueMax

  const runSearch = useCallback(async (
    q: string,
    types: Set<ContractType>,
    statuses: Set<ContractStatus>,
    dateFrom: string,
    dateTo: string,
    minVal: string,
    maxVal: string,
  ) => {
    const needsSearch = q.trim() || types.size > 0 || statuses.size > 0 || dateFrom || dateTo || minVal || maxVal
    if (!needsSearch) {
      setResults([])
      setTotal(0)
      setSearched(false)
      return
    }

    setLoading(true)
    setSearched(true)
    try {
      let allResults: SearchResult[] = []

      if (q.trim()) {
        // Use the FTS endpoint: searches title, counterparty, notes, and extracted document text
        const params = new URLSearchParams({ q: q.trim(), limit: "100" })
        const res = await fetch(`/api/search?${params}`)
        if (res.ok) {
          const data = await res.json()
          allResults = (data.results ?? []).map((r: SearchResult) => r)
        }
      } else {
        // Filter-only mode: use the contracts API (no text query)
        const params = new URLSearchParams({ limit: "100" })
        const statusList = statuses.size > 0 ? Array.from(statuses) : [undefined]

        await Promise.all(
          statusList.map(async (status) => {
            const p = new URLSearchParams(params)
            if (status) p.set("status", status)
            const res = await fetch(`/api/contracts?${p}`)
            if (res.ok) {
              const data = await res.json()
              allResults = [...allResults, ...(data.contracts ?? [])]
            }
          })
        )

        // Deduplicate by id
        const seen = new Set<string>()
        allResults = allResults.filter((r) => {
          if (seen.has(r.id)) return false
          seen.add(r.id)
          return true
        })
      }

      // Client-side filtering for type, status (when using FTS), date range, value range
      if (types.size > 0) {
        allResults = allResults.filter((r) => r.contractType && types.has(r.contractType))
      }
      if (statuses.size > 0 && q.trim()) {
        allResults = allResults.filter((r) => statuses.has(r.status))
      }
      if (dateFrom) {
        allResults = allResults.filter((r) => r.endDate && r.endDate >= dateFrom)
      }
      if (dateTo) {
        allResults = allResults.filter((r) => r.endDate && r.endDate <= dateTo)
      }
      if (minVal) {
        allResults = allResults.filter((r) => r.value != null && r.value >= Number(minVal))
      }
      if (maxVal) {
        allResults = allResults.filter((r) => r.value != null && r.value <= Number(maxVal))
      }

      setResults(allResults)
      setTotal(allResults.length)
    } catch {
      setResults([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    runSearch(debouncedQuery, selectedTypes, selectedStatuses, endDateFrom, endDateTo, valueMin, valueMax)
    const params = new URLSearchParams(window.location.search)
    if (debouncedQuery) params.set("q", debouncedQuery)
    else params.delete("q")
    window.history.replaceState(null, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`)
  }, [debouncedQuery, selectedTypes, selectedStatuses, endDateFrom, endDateTo, valueMin, valueMax, runSearch])

  function toggleType(t: ContractType) {
    setSelectedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  function toggleStatus(s: ContractStatus) {
    setSelectedStatuses((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  return (
    <div className="flex h-full">
      {/* Left filter panel */}
      <aside className="flex h-full w-52 shrink-0 flex-col border-r border-border bg-card overflow-y-auto">
        <div className="border-b border-border px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground">Filters</span>
        </div>

        <div className="p-4 space-y-6">
          {/* Type */}
          <div>
            <p className="mb-2 text-xs font-medium text-foreground">Type</p>
            <div className="space-y-1.5">
              {CONTRACT_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedTypes.has(t)}
                    onChange={() => toggleType(t)}
                    className="size-4 rounded border-input accent-foreground"
                  />
                  <span className={cn("text-sm", selectedTypes.has(t) ? "text-foreground" : "text-muted-foreground")}>
                    {t}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Status */}
          <div>
            <p className="mb-2 text-xs font-medium text-foreground">Status</p>
            <div className="space-y-1.5">
              {STATUS_OPTIONS.map((s) => (
                <label key={s} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedStatuses.has(s)}
                    onChange={() => toggleStatus(s)}
                    className="size-4 rounded border-input accent-foreground"
                  />
                  <span className={cn("text-sm", selectedStatuses.has(s) ? "text-foreground" : "text-muted-foreground")}>
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* End Date */}
          <div>
            <p className="mb-2 text-xs font-medium text-foreground">End Date</p>
            <div className="space-y-2">
              <div>
                <p className="mb-1 text-xs text-muted-foreground">From</p>
                <Input
                  type="date"
                  value={endDateFrom}
                  onChange={(e) => setEndDateFrom(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">To</p>
                <Input
                  type="date"
                  value={endDateTo}
                  onChange={(e) => setEndDateTo(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Value */}
          <div>
            <p className="mb-2 text-xs font-medium text-foreground">Value</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Min</p>
                <Input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={valueMin}
                  onChange={(e) => setValueMin(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Max</p>
                <Input
                  type="number"
                  min="0"
                  placeholder="Any"
                  value={valueMax}
                  onChange={(e) => setValueMax(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex h-full flex-1 flex-col overflow-auto">
        {/* Search input */}
        <div className="border-b border-border px-6 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Search contracts, counterparties..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 p-6">
          {loading ? (
            <div className="rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9 text-xs font-medium text-muted-foreground">Name</TableHead>
                    <TableHead className="h-9 text-xs font-medium text-muted-foreground">Counterparty</TableHead>
                    <TableHead className="h-9 text-xs font-medium text-muted-foreground">Type</TableHead>
                    <TableHead className="h-9 text-xs font-medium text-muted-foreground">Status</TableHead>
                    <TableHead className="h-9 text-xs font-medium text-muted-foreground">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <TableCell key={j} className="py-2.5">
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : results.length > 0 ? (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                {total} result{total !== 1 ? "s" : ""}
                {debouncedQuery ? ` for "${debouncedQuery}"` : ""}
                {hasFilters ? " (filtered)" : ""}
              </p>
              <div className="rounded-lg border border-border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-9 text-xs font-medium text-muted-foreground">Name</TableHead>
                      <TableHead className="h-9 text-xs font-medium text-muted-foreground">Counterparty</TableHead>
                      <TableHead className="h-9 text-xs font-medium text-muted-foreground">Type</TableHead>
                      <TableHead className="h-9 text-xs font-medium text-muted-foreground">Status</TableHead>
                      <TableHead className="h-9 text-xs font-medium text-muted-foreground">Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r) => (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => router.push(`/contracts/${r.id}`)}
                      >
                        <TableCell className="py-2.5 text-sm font-medium text-foreground">
                          <span className="line-clamp-1">{r.title}</span>
                        </TableCell>
                        <TableCell className="py-2.5 text-sm text-muted-foreground">
                          {r.counterpartyName ?? "—"}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <TypeBadge type={r.contractType} />
                        </TableCell>
                        <TableCell className="py-2.5">
                          <StatusBadge status={r.status} />
                        </TableCell>
                        <TableCell className="py-2.5 text-sm text-muted-foreground">
                          {new Date(r.createdAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : searched ? (
            <div className="flex flex-col items-center justify-center pt-20">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <FileText className="size-6 text-muted-foreground" />
              </div>
              <p className="mt-3 text-sm font-medium text-foreground">No results</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try adjusting your search or filters
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center pt-20">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <FileText className="size-6 text-muted-foreground" />
              </div>
              <h3 className="mt-3 text-sm font-medium text-foreground">Search your contracts</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Search across titles, counterparties, notes, and extracted text
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

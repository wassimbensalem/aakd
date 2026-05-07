"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Plus, Search, ChevronLeft, ChevronRight, MoreHorizontal, FileText, Archive, Eye, FolderOpen, Settings2 } from "lucide-react"
import { toast } from "sonner"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TypeBadge, StatusBadge } from "@/components/contract-badges"
import { Contract, ContractStatus, Folder } from "@/lib/types"
import { cn } from "@/lib/utils"

const STATUS_FILTERS: (ContractStatus | "ALL")[] = [
  "ALL", "ACTIVE", "DRAFT", "EXPIRED", "ARCHIVED",
]

const STATUS_LABELS: Record<ContractStatus | "ALL", string> = {
  ALL:                "All",
  ACTIVE:             "Active",
  DRAFT:              "Draft",
  INTERNAL_REVIEW:    "Internal Review",
  PENDING_APPROVAL:   "Pending Approval",
  AWAITING_SIGNATURE: "Awaiting Signature",
  EXPIRED:            "Expired",
  TERMINATED:         "Terminated",
  ARCHIVED:           "Archived",
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function formatCurrency(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

interface FolderWithCount extends Folder {
  _count?: { contracts: number }
  children?: FolderWithCount[]
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
  const [statusFilter, setStatusFilter] = useState<ContractStatus | "ALL">(
    (searchParams.get("status") as ContractStatus) ?? "ALL",
  )
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [folders, setFolders] = useState<FolderWithCount[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const debouncedSearch = useDebounce(search, 300)

  useEffect(() => {
    fetch("/api/folders")
      .then((r) => r.json())
      .then((data) => setFolders(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  const fetchContracts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (debouncedSearch) params.set("search", debouncedSearch)
      if (statusFilter && statusFilter !== "ALL") params.set("status", statusFilter)
      if (selectedFolder) params.set("folderId", selectedFolder)
      params.set("limit", String(pageSize))
      params.set("page", String(page))

      const res = await fetch(`/api/contracts?${params}`)
      if (!res.ok) throw new Error("Failed")
      const data = await res.json()
      setContracts(data.contracts ?? data ?? [])
      setTotal(data.total ?? (data.contracts ?? data ?? []).length)
    } catch {
      toast.error("Failed to load contracts")
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, statusFilter, selectedFolder, page])

  useEffect(() => {
    fetchContracts()
    setSelectedIds(new Set())
  }, [fetchContracts])

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
      toast.error("Failed to archive")
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === contracts.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(contracts.map((c) => c.id)))
    }
  }

  const totalPages = Math.ceil(total / pageSize)
  const allSelected = contracts.length > 0 && selectedIds.size === contracts.length

  return (
    <div className="flex h-full">
      {/* Folders sidebar */}
      <aside className="flex h-full w-48 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span className="text-xs font-medium text-muted-foreground">Folders</span>
          <Settings2 className="size-3.5 text-muted-foreground" />
        </div>
        <nav className="flex-1 overflow-y-auto p-1.5">
          <button
            onClick={() => { setSelectedFolder(null); setPage(1) }}
            className={cn(
              "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors",
              selectedFolder === null
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
            )}
          >
            <span className="flex items-center gap-2">
              <FolderOpen className="size-3.5" />
              All Contracts
            </span>
            <span className="text-xs tabular-nums">{total}</span>
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => { setSelectedFolder(f.id); setPage(1) }}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors",
                selectedFolder === f.id
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
              )}
            >
              <span className="flex items-center gap-2 min-w-0">
                <FolderOpen className="size-3.5 shrink-0" />
                <span className="truncate">{f.name}</span>
              </span>
              {f._count != null && (
                <span className="text-xs tabular-nums">{f._count.contracts}</span>
              )}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex h-full flex-1 flex-col overflow-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-foreground">Contracts</h1>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                className="h-8 w-56 pl-8 text-sm"
              />
            </div>
            <Link href="/contracts/new" className={buttonVariants({ size: "sm" })}>
              <Plus className="size-4" />
              New Contract
            </Link>
          </div>
        </div>

        {/* Status Filter Chips */}
        <div className="mt-4 flex gap-1.5">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter}
              onClick={() => {
                setStatusFilter(filter)
                setPage(1)
              }}
              className={cn(
                "rounded px-2.5 py-1 text-sm font-medium transition-colors",
                statusFilter === filter
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {STATUS_LABELS[filter]}
            </button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div className="mt-4 rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10" />
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Name</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Counterparty</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Type</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Status</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Value</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">End Date</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j} className="py-2.5">
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : contracts.length === 0 ? (
          <div className="mt-16 flex flex-col items-center justify-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <FileText className="size-6 text-muted-foreground" />
            </div>
            <h3 className="mt-3 text-sm font-medium text-foreground">No contracts</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {search || statusFilter !== "ALL"
                ? "No contracts match your filters"
                : "Upload your first contract to get started"}
            </p>
            {!search && statusFilter === "ALL" && (
              <Link href="/contracts/new" className={buttonVariants({ size: "sm" }) + " mt-4"}>Upload Contract</Link>
            )}
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10 pl-4">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="size-4 rounded border-input accent-foreground cursor-pointer"
                    />
                  </TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Name</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Counterparty</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Type</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Status</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Value</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">End Date</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((c) => (
                  <TableRow key={c.id} className={cn("hover:bg-muted/50", selectedIds.has(c.id) && "bg-muted/30")}>
                    <TableCell className="w-10 pl-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(c.id)}
                        onChange={() => toggleSelect(c.id)}
                        className="size-4 rounded border-input accent-foreground cursor-pointer"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </TableCell>
                    <TableCell className="py-2.5">
                      <Link
                        href={`/contracts/${c.id}`}
                        className="text-sm font-medium text-foreground hover:underline"
                      >
                        {c.title}
                      </Link>
                    </TableCell>
                    <TableCell className="py-2.5 text-sm text-muted-foreground">
                      {c.counterpartyName ?? "—"}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <TypeBadge type={c.contractType} />
                    </TableCell>
                    <TableCell className="py-2.5">
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="py-2.5 text-sm tabular-nums text-muted-foreground">
                      {c.value != null ? formatCurrency(c.value, c.currency ?? "USD") : "—"}
                    </TableCell>
                    <TableCell className="py-2.5 text-sm text-muted-foreground">
                      {c.endDate
                        ? new Date(c.endDate).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => router.push(`/contracts/${c.id}`)}>
                            <Eye className="size-4" />
                            View
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => archiveContract(c.id)} variant="destructive">
                            <Archive className="size-4" />
                            Archive
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {total} contract{total !== 1 ? "s" : ""}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 1}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="px-2 text-sm">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => setPage((p) => p + 1)}
                disabled={page === totalPages}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

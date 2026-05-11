"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Plus, Search, ChevronLeft, ChevronRight,
  MoreHorizontal, FileText, Archive, Eye, Download,
} from "lucide-react"
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
import { StatusBadge } from "@/components/contract-badges"
import { EmptyState } from "@/components/ui/empty-state"
import { Contract, ContractStatus } from "@/lib/types"
import { useSession } from "@/lib/auth/client"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

// ── Filter configuration ───────────────────────────────────────────────────
interface FilterConfig {
  label: string
  status: ContractStatus | "ALL"
}

// ── Utilities ──────────────────────────────────────────────────────────────
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

/** Returns two-letter initials from a full name (e.g. "Alex Johnson" → "AJ") */
function ownerInitials(name?: string | null): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function ContractsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const t = useTranslations("contracts")

  const FILTERS: FilterConfig[] = [
    { label: t("filterAll"),      status: "ALL"                },
    { label: t("filterActive"),   status: "ACTIVE"             },
    { label: t("filterDraft"),    status: "DRAFT"              },
    { label: t("filterInReview"), status: "INTERNAL_REVIEW"    },
    { label: t("filterSigned"),   status: "AWAITING_SIGNATURE" },
    { label: t("filterPending"),  status: "PENDING_APPROVAL"   },
    { label: t("filterExpiring"), status: "EXPIRED"            },
  ]

  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const pageSize = 20

  const [search, setSearch] = useState(searchParams.get("search") ?? "")
  const [activeFilter, setActiveFilter] = useState<ContractStatus | "ALL">(
    (searchParams.get("status") as ContractStatus) ?? "ALL",
  )
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [role, setRole] = useState<string>("member")
  const debouncedSearch = useDebounce(search, 300)

  const canManage = role === "admin" || role === "legal" || role === "owner"

  // Fetch current user's org role
  useEffect(() => {
    if (!session?.user) return
    const controller = new AbortController()
    fetch("/api/org/members", { signal: controller.signal })
      .then((r) => r.json())
      .then((members) => {
        if (Array.isArray(members)) {
          const me = members.find(
            (m: { userId: string; role: string }) => m.userId === session.user.id,
          )
          if (me?.role) setRole(me.role)
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [session?.user])

  const fetchContracts = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        if (debouncedSearch) params.set("search", debouncedSearch)
        if (activeFilter && activeFilter !== "ALL") params.set("status", activeFilter)
        params.set("limit", String(pageSize))
        params.set("page", String(page))

        const res = await fetch(`/api/contracts?${params}`, { signal })
        if (!res.ok) throw new Error("Failed")
        const data = await res.json()
        setContracts(data.contracts ?? data ?? [])
        setTotal(data.total ?? (data.contracts ?? data ?? []).length)
      } catch (e) {
        if ((e as Error).name === "AbortError") return
        toast.error(t("failedToLoad"))
      } finally {
        setLoading(false)
      }
    },
    [debouncedSearch, activeFilter, page],
  )

  useEffect(() => {
    const controller = new AbortController()
    fetchContracts(controller.signal)
    setSelectedIds(new Set())
    return () => controller.abort()
  }, [fetchContracts])

  // ── Actions ──────────────────────────────────────────────────────────────
  async function archiveContract(id: string) {
    try {
      const res = await fetch(`/api/contracts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ARCHIVED" }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.message ?? err.error ?? t("failedToArchive"))
        return
      }
      toast.success(t("contractArchived"))
      // Bust the router cache so the dashboard reflects the removal immediately.
      router.refresh()
      fetchContracts()
    } catch {
      toast.error(t("failedToArchive"))
    }
  }

  async function archiveSelected() {
    await Promise.allSettled(Array.from(selectedIds).map(archiveContract))
    setSelectedIds(new Set())
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

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col overflow-auto">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between border-b border-border px-7 py-5">
        <div>
          <h1 className="text-[18px] font-bold text-foreground">{t("title")}</h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {total} contract{total !== 1 ? "s" : ""} in your repository
          </p>
        </div>
        <Link href="/contracts/new" className={buttonVariants({ size: "sm" })}>
          <Plus className="size-4" />
          {t("newContract")}
        </Link>
      </div>

      <div className="flex flex-col gap-3.5 p-7">

        {/* ── Filters bar ───────────────────────────────────────────────── */}
        <div className="flex items-center gap-2.5">
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              className="h-8 w-60 pl-8 text-[12.5px]"
            />
          </div>

          {/* Status pill filters */}
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.label}
                onClick={() => { setActiveFilter(f.status); setPage(1) }}
                className={cn(
                  "rounded-full px-2.5 py-[3px] text-[11.5px] font-medium transition-colors",
                  activeFilter === f.status
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground/80 hover:bg-muted-foreground/[0.12] hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Bulk actions — visible when at least one row is selected */}
          {selectedIds.size > 0 && (
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-[12px] text-muted-foreground">
                {selectedIds.size} selected
              </span>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[12px]">
                <Download className="size-3.5" />
                {t("export")}
              </Button>
              {canManage && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 gap-1.5 text-[12px]"
                  onClick={archiveSelected}
                >
                  <Archive className="size-3.5" />
                  {t("archive")}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* ── Table ─────────────────────────────────────────────────────── */}
        {loading ? (
          /* Skeleton */
          <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-9 bg-muted" />
                  {[t("tableContract"), t("tableCounterparty"), t("tableStatus"), t("tableValue"), t("tableEndDate"), t("tableOwner"), ""].map(
                    (h) => (
                      <TableHead
                        key={h}
                        className="h-9 bg-muted text-[10.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground"
                      >
                        {h}
                      </TableHead>
                    ),
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 6 }).map((_, i) => (
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
          /* Empty state */
          <EmptyState
            icon={FileText}
            title={t("noContracts")}
            description={
              search || activeFilter !== "ALL"
                ? t("noContractsFilter")
                : t("createFirst")
            }
            action={!search && activeFilter === "ALL" ? t("newContract") : undefined}
            onAction={
              !search && activeFilter === "ALL"
                ? () => router.push("/contracts/new")
                : undefined
            }
          />
        ) : (
          /* Data table */
          <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {/* Checkbox column */}
                  <TableHead className="w-9 border-b border-border bg-muted pl-4">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="size-3.5 cursor-pointer rounded border-border accent-primary"
                    />
                  </TableHead>
                  {[t("tableContract"), t("tableCounterparty"), t("tableStatus"), t("tableValue"), t("tableEndDate"), t("tableOwner"), ""].map(
                    (h) => (
                      <TableHead
                        key={h}
                        className="h-9 border-b border-border bg-muted text-[10.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground"
                      >
                        {h}
                      </TableHead>
                    ),
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((c, idx) => (
                  <TableRow
                    key={c.id}
                    onClick={() => router.push(`/contracts/${c.id}`)}
                    className={cn(
                      "cursor-pointer transition-colors",
                      idx < contracts.length - 1 && "border-b border-border",
                      selectedIds.has(c.id) ? "bg-muted/40" : "hover:bg-muted/50",
                    )}
                  >
                    {/* ── Checkbox ──────────────────────────────────────── */}
                    <TableCell
                      className="w-9 py-2 pl-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(c.id)}
                        onChange={() => toggleSelect(c.id)}
                        className="size-3.5 cursor-pointer rounded border-border accent-primary"
                      />
                    </TableCell>

                    {/* ── Contract name + optional CRM badge ────────────── */}
                    <TableCell className="py-2 text-[12.5px] font-medium">
                      <div className="flex items-center gap-1.5">
                        <span>{c.title}</span>
                        {c.crmLinks && c.crmLinks.length > 0 && (
                          <span className="rounded-[3px] bg-muted px-[5px] py-[1px] text-[9px] font-semibold uppercase text-muted-foreground">
                            {c.crmLinks[0].provider.toLowerCase()}
                          </span>
                        )}
                      </div>
                    </TableCell>

                    {/* ── Counterparty ───────────────────────────────────── */}
                    <TableCell className="py-2 text-[12.5px] text-muted-foreground">
                      {c.counterpartyName ?? "—"}
                    </TableCell>

                    {/* ── Status badge ───────────────────────────────────── */}
                    <TableCell className="py-2">
                      <StatusBadge status={c.status} />
                    </TableCell>

                    {/* ── Value ──────────────────────────────────────────── */}
                    <TableCell className="py-2 text-[12.5px] tabular-nums text-muted-foreground">
                      {c.value != null
                        ? formatCurrency(c.value, c.currency ?? "USD")
                        : "—"}
                    </TableCell>

                    {/* ── End date ───────────────────────────────────────── */}
                    <TableCell className="py-2 text-[12px] text-muted-foreground">
                      {c.endDate
                        ? new Date(c.endDate).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "—"}
                    </TableCell>

                    {/* ── Owner avatar ───────────────────────────────────── */}
                    <TableCell className="py-2">
                      {c.owner?.image ? (
                        <img
                          src={c.owner.image}
                          className="w-full h-full object-cover rounded-full"
                          alt={c.owner?.name ?? c.ownerId}
                          title={c.owner?.name ?? c.ownerId}
                          style={{ width: "22px", height: "22px" }}
                        />
                      ) : (
                        <div
                          title={c.owner?.name ?? c.ownerId}
                          className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                          style={{ fontSize: 9, fontWeight: 700 }}
                        >
                          {ownerInitials(c.owner?.name)}
                        </div>
                      )}
                    </TableCell>

                    {/* ── Row menu ───────────────────────────────────────── */}
                    <TableCell
                      className="py-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                          <MoreHorizontal className="size-[15px]" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => router.push(`/contracts/${c.id}`)}
                          >
                            <Eye className="size-4" />
                            {t("view")}
                          </DropdownMenuItem>
                          {canManage && (
                            <DropdownMenuItem
                              onClick={() => archiveContract(c.id)}
                              variant="destructive"
                            >
                              <Archive className="size-4" />
                              {t("archiveAction")}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* ── Pagination ────────────────────────────────────────────────── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-[12.5px] text-muted-foreground">
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
              <span className="px-2 text-[12.5px] text-foreground/70">
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

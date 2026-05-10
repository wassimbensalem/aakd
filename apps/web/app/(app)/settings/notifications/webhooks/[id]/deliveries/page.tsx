"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { format } from "date-fns"
import { ChevronLeft, ChevronRight, ChevronRight as Chevron } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface Delivery {
  id: string
  eventName: string
  attempt: number
  httpStatus: number | null
  status: "pending" | "success" | "failed"
  durationMs: number | null
  deliveredAt: string | null
  createdAt: string
}

interface Webhook {
  id: string
  label: string
  urlPreview: string
  enabled: boolean
  createdAt: string
}

const PAGE_SIZE = 50

function StatusBadge({ status }: { status: Delivery["status"] }) {
  if (status === "success") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
        success
      </Badge>
    )
  }
  if (status === "failed") {
    return (
      <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-100">
        failed
      </Badge>
    )
  }
  return (
    <Badge className="bg-muted text-foreground hover:bg-muted">
      pending
    </Badge>
  )
}

export default function WebhookDeliveriesPage() {
  const params = useParams<{ id: string }>()
  const webhookId = params.id

  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [webhook, setWebhook] = useState<Webhook | null>(null)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  async function load() {
    setLoading(true)
    try {
      const [list, all] = await Promise.all([
        fetch(
          `/api/org/webhooks/${webhookId}/deliveries?page=${page}&limit=${PAGE_SIZE}`,
        ),
        fetch("/api/org/webhooks"),
      ])
      if (list.status === 404) {
        setWebhook(null)
        setDeliveries([])
        setTotal(0)
        return
      }
      if (!list.ok) throw new Error()
      const d = await list.json()
      setDeliveries(d.deliveries ?? [])
      setTotal(d.total ?? 0)

      if (all.ok) {
        const allData = await all.json()
        const found = (allData.webhooks ?? []).find(
          (w: Webhook) => w.id === webhookId,
        )
        setWebhook(found ?? null)
      }
    } catch {
      toast.error("Failed to load delivery log")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, webhookId])

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/settings/org" className="hover:text-foreground">
          Settings
        </Link>
        <Chevron className="h-3.5 w-3.5" />
        <Link
          href="/settings/notifications"
          className="hover:text-foreground"
        >
          Notifications
        </Link>
        <Chevron className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium">
          {webhook?.label ?? "Webhook"}
        </span>
        <Chevron className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium">Deliveries</span>
      </nav>

      <div>
        <h1 className="text-xl font-semibold text-foreground">
          Delivery log{webhook ? ` — ${webhook.label}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          {total} total {total === 1 ? "delivery" : "deliveries"} (newest first)
        </p>
      </div>

      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Event</TableHead>
              <TableHead className="w-20">Attempt</TableHead>
              <TableHead className="w-24">HTTP</TableHead>
              <TableHead className="w-28">Duration</TableHead>
              <TableHead>Delivered at</TableHead>
              <TableHead className="w-24">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : deliveries.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No deliveries yet
                </TableCell>
              </TableRow>
            ) : (
              deliveries.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs text-foreground">
                    {d.eventName}
                  </TableCell>
                  <TableCell>{d.attempt}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {d.httpStatus ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {d.durationMs != null ? `${d.durationMs} ms` : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {d.deliveredAt
                      ? format(new Date(d.deliveredAt), "MMM d, yyyy HH:mm")
                      : format(new Date(d.createdAt), "MMM d, yyyy HH:mm")}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={d.status} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div>
          Page {page} of {totalPages}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

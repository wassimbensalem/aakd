import Link from "next/link"
import { cookies } from "next/headers"
import { differenceInDays, formatDistanceToNow } from "date-fns"
import { StatCard } from "@/components/stat-card"
import { StatusBadge, DaysRemainingBadge } from "@/components/contract-badges"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Contract, ContractAlert, Activity } from "@/lib/types"

async function apiFetch<T>(path: string): Promise<T | null> {
  try {
    const cookieStore = await cookies()
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}${path}`,
      { headers: { cookie: cookieStore.toString() }, cache: "no-store" },
    )
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

const ACTION_VERBS: Partial<Record<string, string>> = {
  CREATED:            "created",
  UPLOADED:           "uploaded",
  UPDATED:            "edited",
  STATUS_CHANGED:     "changed status of",
  METADATA_EXTRACTED: "extracted AI fields from",
  METADATA_UPDATED:   "updated AI fields for",
  ARCHIVED:           "archived",
  TAGGED:             "tagged",
  COMMENTED:          "commented on",
  SIGNED:             "signed",
  APPROVED:           "approved",
  REJECTED:           "rejected",
}

type ActivityWithContract = Activity & {
  contract?: { id: string; title: string } | null
}

export default async function DashboardPage() {
  const [totalData, activeData, expiredData, recentData, alertsData, activitiesData] = await Promise.all([
    apiFetch<{ total: number }>("/api/contracts?limit=1"),
    apiFetch<{ total: number }>("/api/contracts?status=ACTIVE&limit=1"),
    apiFetch<{ total: number }>("/api/contracts?status=EXPIRED&limit=1"),
    apiFetch<{ contracts: Contract[] }>("/api/contracts?limit=6"),
    apiFetch<{ alerts: ContractAlert[] }>("/api/alerts?limit=5"),
    apiFetch<{ activities: ActivityWithContract[] }>("/api/activities?limit=8"),
  ])

  const total = totalData?.total ?? 0
  const active = activeData?.total ?? 0
  const expired = expiredData?.total ?? 0
  const recentContracts = recentData?.contracts ?? []
  const alerts = alertsData?.alerts ?? []
  const activities = activitiesData?.activities ?? []
  const expiringSoon = alerts.filter((a) => a.alertType === "EXPIRY_30" && !a.firedAt).length

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>

      {/* Stat Cards */}
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Total Contracts" value={total} />
        <StatCard title="Active" value={active} />
        <StatCard title="Expiring Soon" value={expiringSoon} subtitle="Next 30 days" />
        <StatCard title="Expired" value={expired} />
      </div>

      {/* Two Column Layout */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: Recent Contracts */}
        <div className="rounded-lg border border-border bg-card lg:col-span-2">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-medium text-foreground">Recent Contracts</h2>
          </div>
          {recentContracts.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No contracts yet.{" "}
              <Link href="/contracts/new" className="text-foreground underline underline-offset-4">
                Upload your first
              </Link>
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Name</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Counterparty</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">Status</TableHead>
                  <TableHead className="h-9 text-xs font-medium text-muted-foreground">End Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentContracts.map((c) => (
                  <TableRow key={c.id} className="hover:bg-muted/50">
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
                      <StatusBadge status={c.status} />
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Right Column */}
        <div className="space-y-4">
          {/* Expiring Soon */}
          <div className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-medium text-foreground">Expiring Soon</h2>
            </div>
            <div className="divide-y divide-border">
              {alerts.filter((a) => !a.firedAt).length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No contracts expiring soon
                </p>
              ) : (
                alerts
                  .filter((a) => !a.firedAt)
                  .slice(0, 5)
                  .map((alert) => {
                    const days = differenceInDays(new Date(alert.triggerDate), new Date())
                    return (
                      <div
                        key={alert.id}
                        className="flex items-center justify-between px-4 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          {alert.contract ? (
                            <Link
                              href={`/contracts/${alert.contract.id}`}
                              className="block truncate text-sm font-medium text-foreground hover:underline"
                            >
                              {alert.contract.title}
                            </Link>
                          ) : (
                            <p className="truncate text-sm text-muted-foreground">Unknown</p>
                          )}
                          <p className="truncate text-xs text-muted-foreground">
                            {alert.alertType.replace(/_/g, " ")}
                          </p>
                        </div>
                        <DaysRemainingBadge days={days} />
                      </div>
                    )
                  })
              )}
            </div>
          </div>

          {/* Activity */}
          <div className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-medium text-foreground">Activity</h2>
            </div>
            <div className="divide-y divide-border">
              {activities.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No recent activity
                </p>
              ) : (
                activities.map((a) => {
                  const verb = ACTION_VERBS[a.action] ?? a.action.toLowerCase().replace(/_/g, " ")
                  const actor = a.user?.name ?? a.actorLabel
                  const contractTitle = a.contract?.title
                  const contractId = a.contract?.id
                  const ago = formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })
                  return (
                    <div key={a.id} className="px-4 py-2.5">
                      <p className="text-sm text-muted-foreground leading-snug">
                        <span className="font-medium text-foreground">{actor}</span>{" "}
                        {verb}{" "}
                        {contractTitle && contractId ? (
                          <Link
                            href={`/contracts/${contractId}`}
                            className="font-medium text-foreground hover:underline"
                          >
                            {contractTitle}
                          </Link>
                        ) : contractTitle ? (
                          <span className="font-medium text-foreground">{contractTitle}</span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{ago}</p>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

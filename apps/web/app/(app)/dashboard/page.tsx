import Link from "next/link"
import { cookies } from "next/headers"
import { FileText, Clock, CheckSquare, PenSquare, Plus } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ContractStatusBadge } from "@/components/contract-status-badge"
import { Contract } from "@/lib/types"

async function fetchContracts(params: string): Promise<Contract[]> {
  try {
    const cookieStore = await cookies()
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/contracts?${params}`,
      { headers: { cookie: cookieStore.toString() }, cache: "no-store" }
    )
    if (!res.ok) return []
    const data = await res.json()
    return data.contracts ?? data ?? []
  } catch {
    return []
  }
}

function StatCard({ title, value, Icon, color }: {
  title: string
  value: number
  Icon: React.ComponentType<{ className?: string }>
  color: string
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={`flex h-8 w-8 items-center justify-center rounded-md ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  )
}

export default async function DashboardPage() {
  const [active, recent, pendingApproval, awaitingSig] = await Promise.all([
    fetchContracts("status=ACTIVE&limit=1"),
    fetchContracts("limit=5"),
    fetchContracts("status=PENDING_APPROVAL&limit=1"),
    fetchContracts("status=AWAITING_SIGNATURE&limit=1"),
  ])

  const activeCount = Array.isArray(active) ? active.length : 0
  const pendingCount = Array.isArray(pendingApproval) ? pendingApproval.length : 0
  const awaitingCount = Array.isArray(awaitingSig) ? awaitingSig.length : 0

  const recentContracts: Contract[] = Array.isArray(recent) ? recent : []

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <Link href="/contracts/new" className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[0.8rem] font-medium rounded-[min(var(--radius-md),12px)] bg-primary text-primary-foreground transition-colors hover:opacity-90">
          <Plus className="h-3.5 w-3.5" />
          New Contract
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Active Contracts" value={activeCount} Icon={FileText} color="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" />
        <StatCard title="Expiring in 30 days" value={0} Icon={Clock} color="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" />
        <StatCard title="Pending Approval" value={pendingCount} Icon={CheckSquare} color="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" />
        <StatCard title="Awaiting Signature" value={awaitingCount} Icon={PenSquare} color="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400" />
      </div>

      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Recent Contracts</h2>
        {recentContracts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 py-16 gap-3">
            <FileText className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No contracts yet</p>
            <Link href="/contracts/new" className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[0.8rem] font-medium rounded-[min(var(--radius-md),12px)] border border-border bg-background hover:bg-muted transition-colors">
              <Plus className="h-3.5 w-3.5" />
              Upload your first contract
            </Link>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Title</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Type</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Counterparty</th>
                </tr>
              </thead>
              <tbody>
                {recentContracts.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/contracts/${c.id}`} className="font-medium hover:text-primary transition-colors">
                        {c.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c.contractType}</td>
                    <td className="px-4 py-3">
                      <ContractStatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c.counterpartyName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

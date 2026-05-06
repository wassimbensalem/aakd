import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { requireRole } from "@/lib/auth/roles"
import { alertsCheckQueue } from "@/lib/jobs/queues"

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const url = new URL(req.url)
    const contractId = url.searchParams.get("contractId") ?? undefined
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)))
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10))

    const alerts = await prisma.contractAlert.findMany({
      where: {
        contract: { organizationId: ctx.organizationId },
        ...(contractId ? { contractId } : {}),
      },
      include: {
        contract: { select: { id: true, title: true, endDate: true } },
      },
      orderBy: { triggerDate: "asc" },
      take: limit,
      skip: offset,
    })

    return Response.json({ alerts })
  })
}

// ─── POST /api/alerts ─────────────────────────────────────────────────────────
// Manually trigger an alert check run. Admin+ only.
// Enqueues a BullMQ job instead of running inline — keeps response fast and
// uses the same code path as the daily cron.

export async function POST(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const forbidden = requireRole(ctx.role, "admin")
  if (forbidden) return forbidden

  const job = await alertsCheckQueue.add("manual-check", {
    triggeredAt: new Date().toISOString(),
  })

  return Response.json({ queued: true, jobId: job.id }, { status: 202 })
}

import { SECURE_HEADERS } from "@/lib/api-headers"
import { prisma } from "@/lib/db/client"
import IORedis from "ioredis"

const PROBE_TIMEOUT_MS = 1500

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms),
    ),
  ])
}

async function probeDb(): Promise<"ok" | "error"> {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, PROBE_TIMEOUT_MS)
    return "ok"
  } catch {
    return "error"
  }
}

async function probeRedis(): Promise<"ok" | "error"> {
  const url = process.env.REDIS_URL
  if (!url) return "error"
  let client: IORedis | null = null
  try {
    client = new IORedis(url, {
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      lazyConnect: true,
      connectTimeout: PROBE_TIMEOUT_MS,
      ...(url.startsWith("rediss://") ? { tls: {} } : {}),
    })
    await withTimeout(client.connect(), PROBE_TIMEOUT_MS)
    await withTimeout(client.ping(), PROBE_TIMEOUT_MS)
    return "ok"
  } catch {
    return "error"
  } finally {
    client?.disconnect()
  }
}

export async function GET() {
  const [db, redis] = await Promise.all([probeDb(), probeRedis()])

  const allOk = db === "ok" && redis === "ok"
  const status = allOk ? "ok" : "degraded"

  return Response.json(
    { status, timestamp: new Date().toISOString(), checks: { db, redis } },
    { status: allOk ? 200 : 503, headers: SECURE_HEADERS },
  )
}

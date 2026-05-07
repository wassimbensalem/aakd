import { auth } from "@/lib/auth/config"
import { toNextJsHandler } from "better-auth/next-js"
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit"

const handler = toNextJsHandler(auth)

export const GET = handler.GET

// Wrap POST with per-IP rate limiting (10 req/min) to protect login/register
export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"

  const rl = rateLimit(`ip:auth:${ip}`, 10, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter)

  return handler.POST(req)
}

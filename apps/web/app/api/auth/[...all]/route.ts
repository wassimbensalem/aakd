import { auth } from "@/lib/auth/config"
import { toNextJsHandler } from "better-auth/next-js"
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit"

const handler = toNextJsHandler(auth)

export const GET = handler.GET

// Wrap POST with per-IP rate limiting (30 req/min) to protect login/register.
// 10/min was too restrictive — a single login flow can touch the auth endpoint
// several times (session check, sign-in, callback), and Docker routes all
// browser traffic through a single gateway IP.
export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"

  const rl = await rateLimit(`ip:auth:${ip}`, 30, 60_000)
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter)

  // For sign-up requests: validate email length and sanitize the name field
  // before forwarding to Better Auth, which does not enforce these constraints.
  const url = new URL(req.url)
  if (url.pathname.endsWith("/sign-up/email")) {
    let body: Record<string, unknown>
    try {
      body = await req.clone().json()
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 })
    }

    const email = typeof body.email === "string" ? body.email : ""
    if (email.length > 254) {
      return Response.json(
        { error: "Email address must not exceed 254 characters" },
        { status: 422 },
      )
    }

    const name = typeof body.name === "string" ? body.name : ""
    if (name.length > 100) {
      return Response.json(
        { error: "Name must not exceed 100 characters" },
        { status: 422 },
      )
    }
    if (/</.test(name)) {
      return Response.json(
        { error: "Name must not contain HTML tags" },
        { status: 422 },
      )
    }
  }

  return handler.POST(req)
}

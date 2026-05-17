import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { LOCALES, DEFAULT_LOCALE } from "@/lib/i18n/config"

// Routes that don't require authentication
const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/create-org",
  "/accept-invitation",
  "/api/auth",
  "/api/webhooks",
  "/api/user/unsubscribe",
]

// Locale resolution is cookie-based with no URL prefix — `i18n.ts` reads the
// `NEXT_LOCALE` cookie at request time. This middleware ensures a default
// cookie exists so first-time visitors see English instead of an empty value
// hitting the messages loader.
function ensureLocaleCookie(req: NextRequest, res: NextResponse) {
  const current = req.cookies.get("NEXT_LOCALE")?.value
  if (current && (LOCALES as readonly string[]).includes(current)) return res
  res.cookies.set("NEXT_LOCALE", DEFAULT_LOCALE, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  })
  return res
}

export function middleware(req: NextRequest) {
  // Propagate or generate a request ID for log correlation
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID()

  const { pathname } = req.nextUrl

  // Allow public paths and static assets
  const isPublic =
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")

  if (isPublic) {
    const res = ensureLocaleCookie(req, NextResponse.next())
    res.headers.set("x-request-id", requestId)
    return res
  }

  // Allow API routes that carry a Bearer token — the route handler's
  // resolveAuth() will validate the key. Without this check, requests
  // with a valid cf_live_ token but no session cookie are redirected to
  // /login before the route handler ever runs, making API key auth dead.
  const authHeader = req.headers.get("Authorization")
  if (pathname.startsWith("/api/") && authHeader?.startsWith("Bearer ")) {
    const res = ensureLocaleCookie(req, NextResponse.next())
    res.headers.set("x-request-id", requestId)
    return res
  }

  // Check for Better Auth session cookie
  const sessionToken =
    req.cookies.get("better-auth.session_token")?.value ||
    req.cookies.get("__Secure-better-auth.session_token")?.value

  if (!sessionToken) {
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    const res = ensureLocaleCookie(req, NextResponse.redirect(loginUrl))
    res.headers.set("x-request-id", requestId)
    return res
  }

  const res = ensureLocaleCookie(req, NextResponse.next())
  res.headers.set("x-request-id", requestId)
  return res
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public folder files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}

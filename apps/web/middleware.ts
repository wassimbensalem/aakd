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
  const { pathname } = req.nextUrl

  // Allow public paths and static assets
  const isPublic =
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")

  if (isPublic) return ensureLocaleCookie(req, NextResponse.next())

  // Check for Better Auth session cookie
  const sessionToken =
    req.cookies.get("better-auth.session_token")?.value ||
    req.cookies.get("__Secure-better-auth.session_token")?.value

  if (!sessionToken) {
    const loginUrl = new URL("/login", req.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return ensureLocaleCookie(req, NextResponse.redirect(loginUrl))
  }

  return ensureLocaleCookie(req, NextResponse.next())
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

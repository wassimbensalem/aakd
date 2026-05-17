import { createHash, randomUUID } from "crypto"
import bcrypt from "bcryptjs"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/db/client"
import type { RequestContext } from "@/lib/context"

export async function resolveAuth(req: Request): Promise<RequestContext | null> {
  // Read the request ID from the incoming request header (set by Next.js middleware)
  const requestId = req.headers.get("x-request-id") ?? randomUUID()

  // Path 1: Better Auth session (browser)
  try {
    const session = await auth.api.getSession({ headers: req.headers })
    if (session?.user) {
      // Prefer the session's activeOrganizationId; fall back to the user's
      // first membership if it was never set (e.g. setActive() race on signup).
      const orgId = session.session.activeOrganizationId ?? null

      const member = orgId
        ? await prisma.member.findUnique({
            where: {
              userId_organizationId: {
                userId: session.user.id,
                organizationId: orgId,
              },
            },
          })
        : await prisma.member.findFirst({
            where: { userId: session.user.id },
            orderBy: { createdAt: "asc" },
          })

      if (member) {
        return {
          userId: session.user.id,
          organizationId: member.organizationId,
          role: member.role,
          source: "session",
          requestId,
        }
      }
    }
  } catch {}

  // Path 2: API key (Bearer token for agents)
  const bearer = req.headers.get("Authorization")?.replace("Bearer ", "").trim()
  if (bearer?.startsWith("cf_live_")) {
    const lookupHash = createHash("sha256").update(bearer).digest("hex")
    const apiKey = await prisma.apiKey.findUnique({
      where: { lookupHash },
      select: { id: true, keyHash: true, organizationId: true, scopes: true, createdById: true, revokedAt: true, expiresAt: true },
    })

    if (
      apiKey &&
      !apiKey.revokedAt &&
      (!apiKey.expiresAt || apiKey.expiresAt > new Date()) &&
      (await bcrypt.compare(bearer, apiKey.keyHash))
    ) {
      prisma.apiKey.update({ where: { lookupHash }, data: { lastUsedAt: new Date() } }).catch(() => {})

      // Inherit the role from the creator's org membership; fall back to "member"
      // so an API key never silently grants more privilege than its creator has.
      const creatorMember = await prisma.member.findUnique({
        where: {
          userId_organizationId: {
            userId: apiKey.createdById,
            organizationId: apiKey.organizationId,
          },
        },
        select: { role: true },
      })

      return {
        userId: apiKey.createdById,
        organizationId: apiKey.organizationId,
        role: creatorMember?.role ?? "member",
        scopes: apiKey.scopes,
        source: "api_key",
        requestId,
      }
    }
  }

  return null
}

export function requireAuth(ctx: RequestContext | null): ctx is RequestContext {
  return ctx !== null
}

/**
 * For API key contexts, enforce that the key carries the "write" scope.
 * Session-based contexts always pass (scopes only apply to keys).
 * Returns a 403 Response if the key is read-only, otherwise null.
 */
export function requireWriteScope(ctx: RequestContext): Response | null {
  if (ctx.source !== "api_key") return null
  if (ctx.scopes?.includes("write")) return null
  return Response.json(
    { error: "API key is read-only — write scope required" },
    { status: 403 },
  )
}

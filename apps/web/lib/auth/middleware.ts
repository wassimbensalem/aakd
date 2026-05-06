import { createHash } from "crypto"
import bcrypt from "bcryptjs"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/db/client"
import type { RequestContext } from "@/lib/context"

export async function resolveAuth(req: Request): Promise<RequestContext | null> {
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
      return {
        userId: apiKey.createdById,
        organizationId: apiKey.organizationId,
        role: "admin",
        scopes: apiKey.scopes,
        source: "api_key",
      }
    }
  }

  return null
}

export function requireAuth(ctx: RequestContext | null): ctx is RequestContext {
  return ctx !== null
}

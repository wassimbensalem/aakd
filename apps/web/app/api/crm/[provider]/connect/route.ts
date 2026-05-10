import crypto from "node:crypto"
import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { getCrmProvider } from "@/lib/crm"
import { getRedirectUri, normalizeProvider } from "@/lib/crm/route-helpers"

const STATE_COOKIE = "crm_oauth_state"

export async function GET(req: Request, { params }: { params: { provider: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const provider = normalizeProvider(params.provider)
  if (!provider) return Response.json({ error: "invalid_provider" }, { status: 400 })

  if (ctx.role !== "admin" && ctx.role !== "legal") {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  const state = crypto.randomBytes(16).toString("hex")
  const redirectUri = getRedirectUri(provider)

  let authUrl: string
  try {
    authUrl = getCrmProvider(provider).authorizationUrl(state, redirectUri)
  } catch (err) {
    return Response.json(
      { error: (err as Error).message ?? "provider_misconfigured" },
      { status: 500 },
    )
  }

  const cookie = [
    `${STATE_COOKIE}=${state}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=600",
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ")

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      "Set-Cookie": cookie,
    },
  })
}

export async function DELETE(req: Request, { params }: { params: { provider: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const provider = normalizeProvider(params.provider)
  if (!provider) return Response.json({ error: "invalid_provider" }, { status: 400 })

  if (ctx.role !== "admin" && ctx.role !== "legal") {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  return requestContext.run(ctx, async () => {
    const integration = await prisma.crmIntegration.findUnique({
      where: { organizationId_provider: { organizationId: ctx.organizationId, provider } },
      select: { id: true },
    })
    if (!integration) return Response.json({ error: "Not Found" }, { status: 404 })

    // CrmLink rows cascade via the FK to CrmIntegration, but delete explicitly
    // so the operation is idempotent even if the cascade is misconfigured.
    await prisma.crmLink.deleteMany({ where: { integrationId: integration.id } })
    await prisma.crmIntegration.delete({ where: { id: integration.id } })

    return new Response(null, { status: 204 })
  })
}

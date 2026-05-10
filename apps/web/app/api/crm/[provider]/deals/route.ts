import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { getCrmProvider } from "@/lib/crm"
import { ensureFreshToken, normalizeProvider } from "@/lib/crm/route-helpers"

export async function GET(req: Request, { params }: { params: { provider: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const provider = normalizeProvider(params.provider)
  if (!provider) return Response.json({ error: "invalid_provider" }, { status: 400 })

  const url = new URL(req.url)
  const q = (url.searchParams.get("q") ?? "").trim()
  // Pipedrive's search rejects empty terms; HubSpot/Salesforce can list without
  // a query, but the UI always sends one — keep the contract simple.
  if (q.length === 0) {
    return Response.json({ error: "missing_query" }, { status: 400 })
  }

  return requestContext.run(ctx, async () => {
    const integration = await prisma.crmIntegration.findUnique({
      where: { organizationId_provider: { organizationId: ctx.organizationId, provider } },
    })
    if (!integration) return Response.json({ error: "Not Found" }, { status: 404 })

    let fresh
    try {
      fresh = await ensureFreshToken(integration)
    } catch (err) {
      console.error(`[crm.deals] ${provider} token refresh failed:`, err)
      return Response.json({ error: "token_refresh_failed" }, { status: 502 })
    }

    try {
      const deals = await getCrmProvider(provider).searchDeals(fresh, q)
      return Response.json({ deals })
    } catch (err) {
      console.error(`[crm.deals] ${provider} searchDeals failed:`, err)
      return Response.json({ error: "search_failed" }, { status: 502 })
    }
  })
}

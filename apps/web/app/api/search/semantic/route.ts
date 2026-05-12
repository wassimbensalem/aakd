import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { generateEmbedding } from "@/lib/embedding"
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit"
import { Prisma } from "@prisma/client"
import { z } from "zod"

const SemanticSearchSchema = z.object({
  query: z.string().min(1).max(2000),
  limit: z.number().int().min(1).max(50).default(10),
  threshold: z.number().min(0).max(1).default(0.3),
})

type SemanticRow = {
  id: string
  title: string
  contractType: string | null
  status: string
  counterpartyName: string | null
  value: number | null
  currency: string | null
  endDate: Date | null
  createdAt: Date
  similarity: number
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveAuth(req)
    if (!ctx) return new Response("Unauthorized", { status: 401 })

    // Rate limit: 30 requests/min per org
    let rl: Awaited<ReturnType<typeof rateLimit>>
    try {
      rl = await rateLimit(`${ctx.organizationId}:semantic-search`, 30, 60_000)
    } catch (err) {
      console.error("[semantic] rateLimit error:", err)
      // If Redis is unavailable, continue without rate limiting rather than 500ing
      rl = { allowed: true, retryAfter: 0 }
    }
    if (!rl.allowed) return rateLimitResponse(rl.retryAfter)

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 })
    }

    const parsed = SemanticSearchSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const { query, limit, threshold } = parsed.data

    return requestContext.run(ctx, async () => {
      let embedding: number[] | null
      try {
        embedding = await generateEmbedding(query)
      } catch (err) {
        console.error("[semantic] Embedding generation failed:", err)
        return Response.json(
          { error: "Embedding generation failed" },
          { status: 503 },
        )
      }

      if (!embedding) {
        return Response.json(
          { error: "Embedding provider not configured" },
          { status: 503 },
        )
      }

      const embeddingStr = `[${embedding.join(",")}]`

      // Tune ivfflat recall — 10 probes is a reasonable default; higher = better
      // recall at the cost of more CPU. SET applies for the rest of this session
      // (pooled connection), but Prisma reuses connections so it's effectively
      // per-query here. Failing to set is non-fatal (e.g. if the index isn't
      // ivfflat) — fall back silently.
      try {
        await prisma.$executeRaw`SET ivfflat.probes = 10`
      } catch {
        // ignore — extension not loaded or index uses hnsw
      }

      const rows = await prisma.$queryRaw<SemanticRow[]>(
        Prisma.sql`
          SELECT
            c.id,
            c.title,
            c."contractType",
            c.status,
            c."counterpartyName",
            c.value,
            c.currency,
            c."endDate",
            c."createdAt",
            1 - (ce.embedding <=> ${embeddingStr}::vector) AS similarity
          FROM "ContractEmbedding" ce
          JOIN "Contract" c ON c.id = ce."contractId"
          WHERE c."organizationId" = ${ctx.organizationId}
            AND 1 - (ce.embedding <=> ${embeddingStr}::vector) > ${threshold}
          ORDER BY ce.embedding <=> ${embeddingStr}::vector
          LIMIT ${limit}
        `,
      )

      return Response.json({ results: rows, total: rows.length })
    })
  } catch (err) {
    console.error("[semantic-search] Unhandled error:", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}

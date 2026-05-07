import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { Prisma } from "@prisma/client"

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const url = new URL(req.url)
    const q = (url.searchParams.get("q") ?? "").trim()
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)))
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10))

    if (!q) {
      return Response.json({ results: [], total: 0 })
    }

    const orgId = ctx.organizationId

    // Short queries (< 3 chars) or queries that might break tsquery parsing
    // fall back to a simple ILIKE on title.
    const useIlike = q.length < 3

    if (useIlike) {
      const contracts = await prisma.contract.findMany({
        where: {
          organizationId: orgId,
          title: { contains: q, mode: "insensitive" },
        },
        select: {
          id: true,
          title: true,
          contractType: true,
          status: true,
          counterpartyName: true,
          createdAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
        skip: offset,
      })

      const total = await prisma.contract.count({
        where: {
          organizationId: orgId,
          title: { contains: q, mode: "insensitive" },
        },
      })

      return Response.json({ results: contracts, total })
    }

    // Full-text search via PostgreSQL tsvector / tsquery
    // $queryRaw with Prisma.sql ensures safe parameterization — never $queryRawUnsafe
    type FTSRow = {
      id: string
      title: string
      contractType: string | null
      status: string
      counterpartyName: string | null
      value: number | null
      currency: string | null
      endDate: Date | null
      createdAt: Date
      organizationId: string
    }

    let rows: FTSRow[]
    try {
      rows = await prisma.$queryRaw<FTSRow[]>(
        Prisma.sql`
          SELECT
            id,
            title,
            "contractType",
            status,
            "counterpartyName",
            value,
            currency,
            "endDate",
            "createdAt",
            "organizationId"
          FROM "Contract"
          WHERE "organizationId" = ${orgId}
            AND to_tsvector('english',
              coalesce(title, '') || ' ' ||
              coalesce("counterpartyName", '') || ' ' ||
              coalesce(notes, '') || ' ' ||
              coalesce("extractedText", '')
            ) @@ plainto_tsquery('english', ${q})
          ORDER BY ts_rank(
            to_tsvector('english',
              coalesce(title, '') || ' ' ||
              coalesce("counterpartyName", '') || ' ' ||
              coalesce(notes, '') || ' ' ||
              coalesce("extractedText", '')
            ),
            plainto_tsquery('english', ${q})
          ) DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      )
    } catch {
      // tsquery parse failure (e.g. special chars) — fall back to ILIKE
      const contracts = await prisma.contract.findMany({
        where: {
          organizationId: orgId,
          title: { contains: q, mode: "insensitive" },
        },
        select: {
          id: true,
          title: true,
          contractType: true,
          status: true,
          counterpartyName: true,
          value: true,
          currency: true,
          endDate: true,
          createdAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
        skip: offset,
      })

      const total = await prisma.contract.count({
        where: {
          organizationId: orgId,
          title: { contains: q, mode: "insensitive" },
        },
      })

      return Response.json({ results: contracts, total })
    }

    // Count query for pagination — same WHERE clause, no LIMIT/OFFSET
    type CountRow = { count: bigint }
    let countRows: CountRow[]
    try {
      countRows = await prisma.$queryRaw<CountRow[]>(
        Prisma.sql`
          SELECT COUNT(*)::bigint AS count
          FROM "Contract"
          WHERE "organizationId" = ${orgId}
            AND to_tsvector('english',
              coalesce(title, '') || ' ' ||
              coalesce("counterpartyName", '') || ' ' ||
              coalesce(notes, '') || ' ' ||
              coalesce("extractedText", '')
            ) @@ plainto_tsquery('english', ${q})
        `
      )
    } catch {
      countRows = [{ count: BigInt(rows.length) }]
    }

    const total = Number(countRows[0]?.count ?? rows.length)

    // If FTS returned 0 results, try ILIKE as a fallback
    if (rows.length === 0) {
      const fallbackContracts = await prisma.contract.findMany({
        where: {
          organizationId: orgId,
          title: { contains: q, mode: "insensitive" },
        },
        select: {
          id: true,
          title: true,
          contractType: true,
          status: true,
          counterpartyName: true,
          value: true,
          currency: true,
          endDate: true,
          createdAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
        skip: offset,
      })

      if (fallbackContracts.length > 0) {
        const fallbackTotal = await prisma.contract.count({
          where: {
            organizationId: orgId,
            title: { contains: q, mode: "insensitive" },
          },
        })
        return Response.json({ results: fallbackContracts, total: fallbackTotal })
      }
    }

    return Response.json({ results: rows, total })
  })
}

import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { enqueueImportProcess } from "@/lib/types/import-queue"
import { z } from "zod"

const StartCsvSchema = z.object({
  storageKey: z.string().min(1),
  mapping: z.record(z.string(), z.string().nullable()),
  totalRows: z.number().int().positive().max(1000),
})

export async function POST(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 })
  }

  const parsed = StartCsvSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const { storageKey, mapping, totalRows } = parsed.data

  // The browser hands the storageKey back from the preview response. Confirm
  // it lives under this org's prefix before trusting it — without this an
  // attacker could submit another org's preview key and process their CSV.
  const expectedPrefix = `imports/${ctx.organizationId}/`
  if (!storageKey.startsWith(expectedPrefix)) {
    return Response.json({ error: "invalid_storage_key" }, { status: 422 })
  }

  const titleMapped = Object.values(mapping).some((v) => v === "title")
  if (!titleMapped) {
    return Response.json({ error: "title_not_mapped" }, { status: 422 })
  }

  return requestContext.run(ctx, async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const importJobModel = prisma.importJob
    const job = await importJobModel.create({
      data: {
        organizationId: ctx.organizationId,
        source: "CSV",
        status: "PENDING",
        storageKey,
        mappingJson: JSON.stringify(mapping),
        totalRows,
        createdById: ctx.userId,
      },
      select: { id: true, totalRows: true },
    })

    try {
      await enqueueImportProcess({
        importJobId: job.id,
        organizationId: ctx.organizationId,
        createdById: ctx.userId,
      })
    } catch (err) {
      console.error("[import.csv] enqueue failed:", err)
      // Leave the ImportJob in PENDING — admin can retry from the UI.
    }

    return Response.json({ jobId: job.id, totalRows: job.totalRows }, { status: 201 })
  })
}

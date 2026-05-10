import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { enqueueImportProcess } from "@/lib/types/import-queue"
import { z } from "zod"

const ImportSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1).max(50),
})

export async function POST(req: Request) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return Response.json({ error: "google_drive_not_configured" }, { status: 503 })
  }

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

  const parsed = ImportSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  return requestContext.run(ctx, async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const importJobModel = (prisma as any).importJob
    const job = await importJobModel.create({
      data: {
        organizationId: ctx.organizationId,
        source: "GOOGLE_DRIVE",
        status: "PENDING",
        driveFileIds: parsed.data.fileIds.join(","),
        totalRows: parsed.data.fileIds.length,
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
      console.error("[import.gdrive] enqueue failed:", err)
    }

    return Response.json({ jobId: job.id, totalRows: job.totalRows }, { status: 201 })
  })
}

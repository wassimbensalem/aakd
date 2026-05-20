import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { documentExportQueue } from "@/lib/jobs/queues"
import { captureServerEvent } from "@/lib/posthog-server"
import { z } from "zod"

const ExportSchema = z.object({
  format: z.enum(["docx", "pdf"]),
})

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response("Invalid JSON", { status: 400 })
    }
    const parsed = ExportSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true },
    })
    if (!contract || contract.organizationId !== ctx.organizationId) {
      return new Response("Not Found", { status: 404 })
    }

    const document = await prisma.contractDocument.findUnique({
      where: { contractId: params.id },
      select: { id: true },
    })
    if (!document) {
      return Response.json({ error: "no_document" }, { status: 422 })
    }

    const job = await documentExportQueue.add("export", {
      contractId: params.id,
      format: parsed.data.format,
      requestedById: ctx.userId,
      jobId: "",
    })
    if (job.id) {
      await job.updateData({
        contractId: params.id,
        format: parsed.data.format,
        requestedById: ctx.userId,
        jobId: job.id,
      })
    }

    captureServerEvent(ctx.userId, "contract_exported", {
      contractId: params.id,
      format: parsed.data.format,
      organizationId: ctx.organizationId,
    })

    return Response.json({ jobId: job.id }, { status: 202 })
  })
}

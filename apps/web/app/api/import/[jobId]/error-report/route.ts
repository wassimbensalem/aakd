import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { storage } from "@/lib/storage"

export async function GET(req: Request, { params }: { params: { jobId: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const importJobModel = prisma.importJob
    if (!importJobModel) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    const job = await importJobModel.findUnique({
      where: { id: params.jobId },
      select: { id: true, organizationId: true, errorReportKey: true },
    })
    if (!job || job.organizationId !== ctx.organizationId) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }
    if (!job.errorReportKey) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    let signedUrl: string
    try {
      signedUrl = await storage.getSignedDownloadUrl(job.errorReportKey, 3600)
    } catch (err) {
      console.error("[import.error-report] failed to sign url:", err)
      return Response.json({ error: "signing_failed" }, { status: 502 })
    }

    return new Response(null, {
      status: 302,
      headers: { Location: signedUrl },
    })
  })
}

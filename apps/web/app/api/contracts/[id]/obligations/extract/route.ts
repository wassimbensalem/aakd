import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { getObligationExtractQueue, obligationExtractQueue } from "@/lib/jobs/queues"

const ROLES_CAN_WRITE = new Set(["owner", "admin", "legal", "member"])

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  if (!ROLES_CAN_WRITE.has(ctx.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  return requestContext.run(ctx, async () => {
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, organizationId: true, extractedText: true },
    })

    if (!contract || contract.organizationId !== ctx.organizationId) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    if (!contract.extractedText) {
      return Response.json({ error: "no_extracted_text" }, { status: 422 })
    }

    // Check that an AI provider is configured
    const provider =
      process.env.AI_PROVIDER?.toLowerCase() ||
      (process.env.ANTHROPIC_API_KEY
        ? "anthropic"
        : process.env.OPENAI_API_KEY
          ? "openai"
          : process.env.OLLAMA_BASE_URL
            ? "ollama"
            : null)

    if (!provider) {
      return Response.json({ error: "no_ai_provider" }, { status: 422 })
    }

    // Enqueue — pass extractedText so the worker doesn't need another DB round-trip
    const job = await obligationExtractQueue.add("extract", {
      contractId: contract.id,
      extractedText: contract.extractedText.slice(0, 100_000),
      requestedById: ctx.userId,
    })

    return Response.json({ jobId: job.id })
  })
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    // Verify org membership — don't leak job results across orgs
    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { organizationId: true },
    })
    if (!contract || contract.organizationId !== ctx.organizationId) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    const url = new URL(req.url)
    const jobId = url.searchParams.get("jobId")
    if (!jobId) {
      return Response.json({ error: "jobId required" }, { status: 400 })
    }

    const queue = getObligationExtractQueue()
    const job = await queue.getJob(jobId)

    if (!job) {
      return Response.json({ state: "not_found" })
    }

    const state = await job.getState()

    if (state === "completed") {
      return Response.json({ state: "completed", suggestions: job.returnvalue })
    }
    if (state === "failed") {
      return Response.json({ state: "failed", reason: job.failedReason })
    }
    // waiting, active, delayed → still running
    return Response.json({ state: "active" })
  })
}

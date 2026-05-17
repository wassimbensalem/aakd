/**
 * Central dispatcher for import.process jobs.
 *
 * Marks the ImportJob PROCESSING, delegates to the source-specific handler,
 * generates an error report CSV (if any rows failed), and finalizes
 * status/completedAt. Emits an IMPORT_COMPLETED Activity tied to the first
 * successfully imported contract (when any) plus an "import.completed"
 * notification to org admins.
 */
import { getWorkerPrisma } from "@/lib/db/worker-client"
import { storage } from "@/lib/storage"
import { enqueueNotification } from "@/lib/notifications/fanout"
import { logger } from "@/lib/logger"
import type { ImportJob } from "@prisma/client"

import { runCsvHandler } from "./handlers/csv"
import { runBatchHandler } from "./handlers/batch"
import { runPandadocHandler } from "./handlers/pandadoc"
import { runClmExportHandler } from "./handlers/clm-export"

export interface ImportProcessContext {
  importJobId: string
  organizationId: string
  createdById: string
}

export async function processImportJob(ctx: ImportProcessContext): Promise<void> {
  const db = getWorkerPrisma()

  await db.importJob.update({
    where: { id: ctx.importJobId },
    data: { status: "PROCESSING", startedAt: new Date() },
  })

  const job = await db.importJob.findUnique({ where: { id: ctx.importJobId } })
  if (!job) {
    logger.warn({ importJobId: ctx.importJobId }, "[import] job not found — skipping")
    return
  }

  try {
    await dispatch(job, ctx)

    const updated = await db.importJob.findUnique({ where: { id: job.id } })
    const failedRows = updated?.failedRows ?? 0

    let errorReportKey: string | null = null
    if (failedRows > 0) {
      errorReportKey = await generateErrorReport(job.id, ctx.organizationId)
    }

    await db.importJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        errorReportKey,
      },
    })

    // Activity is contract-scoped — pin to the first successful row's contract.
    // If zero contracts were imported (e.g. all rows failed), skip the
    // Activity row but still send the notification.
    const firstSuccess = await db.importRow.findFirst({
      where: { jobId: job.id, status: "success", contractId: { not: null } },
      orderBy: { rowIndex: "asc" },
    })
    const succeededRows = updated?.succeededRows ?? 0
    const totalRows = updated?.totalRows ?? 0

    if (firstSuccess?.contractId) {
      await db.activity.create({
        data: {
          contractId: firstSuccess.contractId,
          userId: null,
          actorLabel: "Import",
          action: "IMPORT_COMPLETED",
          detail: `Imported ${succeededRows}/${totalRows} contract(s) via ${job.source}`,
          metadata: {
            importJobId: job.id,
            source: job.source,
            totalRows,
            succeededRows,
            failedRows,
          },
        },
      })

      await enqueueNotification("import.completed", firstSuccess.contractId, null, {
        importJobId: job.id,
        source: job.source,
        totalRows,
        succeededRows,
        failedRows,
      })
    }
  } catch (err) {
    logger.error({ err, importJobId: job.id }, "[import] job failed catastrophically")
    await db.importJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
      },
    })
    throw err
  }
}

async function dispatch(job: ImportJob, ctx: ImportProcessContext): Promise<void> {
  switch (job.source) {
    case "CSV":
      await runCsvHandler(job, ctx)
      return
    case "BATCH_FILES":
    case "GOOGLE_DRIVE":
      await runBatchHandler(job, ctx)
      return
    case "PANDADOC":
      await runPandadocHandler(job, ctx)
      return
    case "CLM_EXPORT":
      await runClmExportHandler(job, ctx)
      return
    default:
      throw new Error(`Unknown import source: ${job.source}`)
  }
}

async function generateErrorReport(jobId: string, orgId: string): Promise<string> {
  const db = getWorkerPrisma()
  const failed = await db.importRow.findMany({
    where: { jobId, status: "failed" },
    orderBy: { rowIndex: "asc" },
    select: { rowIndex: true, sourceRef: true, errorMessage: true },
  })

  const lines = ["Row,Source Reference,Error Message"]
  for (const row of failed) {
    const ref = String(row.sourceRef ?? "").replace(/"/g, '""')
    const msg = String(row.errorMessage ?? "").replace(/"/g, '""')
    lines.push(`${row.rowIndex},"${ref}","${msg}"`)
  }
  const csv = lines.join("\n")

  const key = `imports/${orgId}/${jobId}/error-report.csv`
  await storage.upload(key, Buffer.from(csv, "utf8"), "text/csv")
  return key
}

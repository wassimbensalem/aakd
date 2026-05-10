// Thin wrapper around the (yet-to-exist) import.process queue. The m10-core
// branch defines `importProcessQueue` in lib/jobs/queues.ts. Until that lands,
// dynamic-resolve at call time so this module's own typecheck does not break.

export interface ImportProcessJobData {
  importJobId: string
  organizationId: string
  createdById: string
}

export async function enqueueImportProcess(data: ImportProcessJobData): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queues = (await import("@/lib/jobs/queues")) as any
  const queue = queues.importProcessQueue ?? queues.getImportProcessQueue?.()
  if (!queue) {
    throw new Error("import.process queue is not configured")
  }
  await queue.add(`import-${data.importJobId}`, data)
}

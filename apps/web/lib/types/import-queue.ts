// Re-export from the real queue module (was a dynamic-import shim while m10-core was pending)
export type { ImportProcessJobData } from "@/lib/jobs/queues"

export async function enqueueImportProcess(data: import("@/lib/jobs/queues").ImportProcessJobData): Promise<void> {
  const { importProcessQueue } = await import("@/lib/jobs/queues")
  await importProcessQueue.add(`import-${data.importJobId}`, data)
}

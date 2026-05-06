import { prisma } from "@/lib/db/client"
import { ActivityAction } from "@prisma/client"

export async function writeActivity(
  contractId: string,
  userId: string | null,
  action: ActivityAction,
  detail?: string,
  metadata?: Record<string, unknown>
) {
  return prisma.activity.create({
    data: {
      contractId,
      userId,
      actorLabel: userId ? undefined : "System",
      action,
      detail,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: metadata as any,
    },
  })
}

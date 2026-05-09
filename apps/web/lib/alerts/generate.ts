import { prisma } from "@/lib/db/client"

/**
 * Idempotently (re)generates renewal alerts for a contract.
 * Deletes all unfired alerts first, then creates new ones based on
 * endDate, renewalDate, and noticePeriodDays.
 *
 * Called:
 *  - After contract creation (if endDate was provided)
 *  - After any PATCH that touches endDate, renewalDate, or noticePeriodDays
 */
export async function generateAlertsForContract(
  contractId: string,
  endDate: Date | null,
  renewalDate: Date | null,
  noticePeriodDays: number | null
): Promise<void> {
  // Step 1: delete unfired alerts so we can rebuild them cleanly
  await prisma.contractAlert.deleteMany({
    where: { contractId, firedAt: null },
  })

  const now = new Date()
  const alerts: { contractId: string; alertType: string; triggerDate: Date }[] = []

  // Step 2: expiry-based alerts from endDate
  if (endDate) {
    if (endDate > now) {
      const offsets: { type: string; days: number }[] = [
        { type: "EXPIRY_90", days: 90 },
        { type: "EXPIRY_30", days: 30 },
        { type: "EXPIRY_7",  days: 7 },
      ]

      for (const { type, days } of offsets) {
        const triggerDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000)
        if (triggerDate > now) {
          alerts.push({ contractId, alertType: type, triggerDate })
        }
      }
    } else {
      // Contract already expired — schedule EXPIRY_PAST alert to fire immediately
      // (triggerDate in the past causes alerts.check to fire it on next run)
      alerts.push({ contractId, alertType: "EXPIRY_PAST", triggerDate: endDate })
    }
  }

  // Step 3: renewal due alert from renewalDate
  if (renewalDate && renewalDate > now) {
    const triggerDate = new Date(renewalDate.getTime() - 14 * 24 * 60 * 60 * 1000)
    if (triggerDate > now) {
      alerts.push({ contractId, alertType: "RENEWAL_DUE", triggerDate })
    }
  }

  // Step 4: notice period alert
  if (noticePeriodDays != null && endDate && endDate > now) {
    const triggerDate = new Date(endDate.getTime() - noticePeriodDays * 24 * 60 * 60 * 1000)
    if (triggerDate > now) {
      alerts.push({ contractId, alertType: "NOTICE_PERIOD", triggerDate })
    }
  }

  // Step 5: batch create all alerts
  if (alerts.length > 0) {
    await prisma.contractAlert.createMany({ data: alerts })
  }
}

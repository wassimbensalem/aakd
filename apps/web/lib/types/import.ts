export type ImportSource = "CSV" | "BATCH_FILES" | "GOOGLE_DRIVE" | "PANDADOC" | "CLM_EXPORT"
export type ImportStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"

export interface ImportJobSummary {
  id: string
  source: ImportSource
  status: ImportStatus
  totalRows: number
  succeededRows: number
  failedRows: number
  errorReportKey: string | null
  storageKey: string | null
  driveFileIds: string | null
  mappingJson: string | null
  startedAt: Date | null
  completedAt: Date | null
  organizationId: string
  createdById: string
  createdAt: Date
  updatedAt: Date
}

export interface ImportRowResult {
  id: string
  jobId: string
  rowIndex: number
  sourceRef: string
  status: "pending" | "success" | "failed" | "skipped"
  errorMessage: string | null
  contractId: string | null
  createdAt: Date
  updatedAt: Date
}

export const FIELD_ALIASES: Record<string, string[]> = {
  title: ["name", "contract name", "title", "contract title"],
  contractType: ["type", "contract type", "category"],
  counterpartyName: ["counterparty", "counterparty name", "vendor", "client", "party"],
  counterpartyContact: ["counterparty contact", "counterparty email", "contact email"],
  value: ["value", "contract value", "amount"],
  currency: ["currency", "currency code"],
  startDate: ["start date", "effective date", "commencement date"],
  endDate: ["end date", "expiry date", "expiration date", "termination date"],
  renewalDate: ["renewal date", "auto renewal date"],
  noticePeriodDays: ["notice period", "notice period days"],
  autoRenewal: ["auto renewal", "auto-renewal", "auto renew"],
  notes: ["notes", "description", "comments"],
  status: ["status"],
}

export const IMPORT_FIELD_NAMES = Object.keys(FIELD_ALIASES)

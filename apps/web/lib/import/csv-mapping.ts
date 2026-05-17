/**
 * Canonical CSV column -> ClauseFlow contract field mapping.
 *
 * Used by:
 *   - The CSV preview API to auto-suggest mappings from a user-uploaded header.
 *   - The CSV import handler in the worker as a typed enum check.
 */

export type ImportField =
  | "title"
  | "contractType"
  | "counterpartyName"
  | "counterpartyContact"
  | "value"
  | "currency"
  | "startDate"
  | "endDate"
  | "renewalDate"
  | "noticePeriodDays"
  | "autoRenewal"
  | "notes"
  | "status"

export const IMPORT_FIELDS: ImportField[] = [
  "title",
  "contractType",
  "counterpartyName",
  "counterpartyContact",
  "value",
  "currency",
  "startDate",
  "endDate",
  "renewalDate",
  "noticePeriodDays",
  "autoRenewal",
  "notes",
  "status",
]

const ALIAS_TABLE: Record<ImportField, string[]> = {
  title: ["name", "contract name", "title", "contract title"],
  contractType: ["type", "contract type", "category"],
  counterpartyName: ["counterparty", "counterparty name", "vendor", "client", "party"],
  counterpartyContact: ["counterparty contact", "counterparty email", "contact email", "contact"],
  value: ["value", "contract value", "amount"],
  currency: ["currency", "currency code"],
  startDate: ["start date", "effective date", "commencement date", "start"],
  endDate: ["end date", "expiry date", "expiration date", "termination date", "end"],
  renewalDate: ["renewal date", "auto renewal date"],
  noticePeriodDays: ["notice period", "notice period days"],
  autoRenewal: ["auto renewal", "auto-renewal", "auto renew"],
  notes: ["notes", "description", "comments"],
  status: ["status"],
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ")
}

export function suggestFieldForHeader(header: string): ImportField | null {
  const norm = normalize(header)
  if (!norm) return null

  // Pass 1: exact alias match
  for (const field of IMPORT_FIELDS) {
    if (ALIAS_TABLE[field].some((alias) => normalize(alias) === norm)) return field
  }
  // Pass 2: substring match (e.g. "Effective Start Date" -> startDate)
  for (const field of IMPORT_FIELDS) {
    if (ALIAS_TABLE[field].some((alias) => norm.includes(normalize(alias)))) return field
  }
  return null
}

export function isImportField(value: unknown): value is ImportField {
  return typeof value === "string" && (IMPORT_FIELDS as string[]).includes(value)
}

export type ContractStatus =
  | "DRAFT"
  | "INTERNAL_REVIEW"
  | "PENDING_APPROVAL"
  | "AWAITING_SIGNATURE"
  | "ACTIVE"
  | "EXPIRED"
  | "TERMINATED"
  | "ARCHIVED"

export type ContractType =
  | "NDA"
  | "MSA"
  | "SOW"
  | "EMPLOYMENT"
  | "VENDOR"
  | "CUSTOMER"
  | "OTHER"

export type ActivityAction =
  | "CREATED"
  | "UPLOADED"
  | "UPDATED"
  | "STATUS_CHANGED"
  | "COMMENTED"
  | "APPROVAL_REQUESTED"
  | "APPROVED"
  | "REJECTED"
  | "SENT_FOR_SIGNATURE"
  | "SIGNED"
  | "ALERT_FIRED"
  | "METADATA_EXTRACTED"
  | "METADATA_UPDATED"
  | "DOWNLOADED"
  | "DELETED"
  | "ARCHIVED"
  | "TAGGED"

export interface Contract {
  id: string
  title: string
  contractType: ContractType | null
  status: ContractStatus
  ownerId: string
  owner?: { id: string; name: string; email: string; image?: string | null }
  counterpartyName?: string | null
  counterpartyContact?: string | null
  value?: number | null
  currency?: string | null
  governingLaw?: string | null
  startDate?: string | null
  endDate?: string | null
  renewalDate?: string | null
  noticePeriodDays?: number | null
  autoRenewal?: boolean
  notes?: string | null
  organizationId: string
  folderId?: string | null
  folder?: { id: string; name: string } | null
  tags?: Tag[]
  files?: ContractFile[]
  activities?: Activity[]
  hasExtractedText?: boolean
  docusealSubmissionId?: string | null
  signingUrl?: string | null
  createdAt: string
  updatedAt: string
}

export interface ContractFile {
  id: string
  contractId: string
  filename: string
  storageKey: string
  mimeType: string
  sizeBytes: number
  isSigned: boolean
  isLatest: boolean
  version: number
  uploadedById: string
  uploadedBy?: { id: string; name: string; image?: string | null }
  createdAt: string
}

export interface Activity {
  id: string
  contractId: string
  userId?: string | null
  user?: { id: string; name: string; image?: string | null } | null
  actorLabel: string
  action: ActivityAction
  detail?: string | null
  createdAt: string
}

export interface Folder {
  id: string
  name: string
  parentId?: string | null
  organizationId: string
  createdAt: string
}

export interface Tag {
  id: string
  name: string
  color?: string | null
  organizationId: string
  createdAt: string
}

export interface ApiKey {
  id: string
  name: string
  prefix: string
  scopes: string[]
  lastUsedAt?: string | null
  expiresAt?: string | null
  revokedAt?: string | null
  createdAt: string
}

export type AlertType = "EXPIRY_90" | "EXPIRY_30" | "EXPIRY_7" | "RENEWAL_DUE" | "NOTICE_PERIOD"

export interface ContractAlert {
  id: string
  contractId: string
  contract?: { id: string; title: string; endDate?: string | null }
  alertType: AlertType
  triggerDate: string
  firedAt?: string | null
  emailSentAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface OrgMember {
  id: string
  userId: string
  organizationId: string
  role: string
  createdAt: string
  user: { id: string; name: string; email: string; image?: string | null }
}

export interface Approval {
  id: string
  contractId: string
  requestedById: string
  requestedBy: { id: string; name: string; email: string; image?: string | null }
  assignedToId: string
  assignedTo: { id: string; name: string; email: string; image?: string | null }
  status: "pending" | "approved" | "rejected"
  comment?: string | null
  decidedAt?: string | null
  createdAt: string
  updatedAt: string
}

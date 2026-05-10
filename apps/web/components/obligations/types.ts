export type ObligationStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE"
export type ObligationPriority = "LOW" | "MEDIUM" | "HIGH"

export interface ObligationSubTask {
  id: string
  title: string
  isCompleted: boolean
  completedAt: string | null
  completedBy: { id: string; name: string } | null
  createdAt?: string
  updatedAt?: string
}

export interface Obligation {
  id: string
  contractId: string
  title: string
  description: string | null
  clauseReference: string | null
  priority: ObligationPriority
  status: ObligationStatus
  dueDate: string
  assignee: { id: string; name: string; email: string } | null
  reminderDays: number
  reminderSentAt: string | null
  completedAt: string | null
  completedBy: { id: string; name: string } | null
  createdBy: { id: string; name: string }
  createdAt: string
  updatedAt: string
  subTasks: ObligationSubTask[]
}

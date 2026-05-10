-- M7: Obligation Tracking
-- Adds ContractObligation + ObligationSubTask models, ObligationStatus and
-- ObligationPriority enums, and the OBLIGATION_* ActivityAction values.

-- CreateEnum: ObligationStatus
CREATE TYPE "ObligationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE');

-- CreateEnum: ObligationPriority
CREATE TYPE "ObligationPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterEnum: extend ActivityAction with obligation events
ALTER TYPE "ActivityAction" ADD VALUE 'OBLIGATION_CREATED';
ALTER TYPE "ActivityAction" ADD VALUE 'OBLIGATION_UPDATED';
ALTER TYPE "ActivityAction" ADD VALUE 'OBLIGATION_COMPLETED';
ALTER TYPE "ActivityAction" ADD VALUE 'OBLIGATION_DELETED';

-- CreateTable: ContractObligation
CREATE TABLE "ContractObligation" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "clauseReference" TEXT,
  "priority" "ObligationPriority" NOT NULL DEFAULT 'MEDIUM',
  "status" "ObligationStatus" NOT NULL DEFAULT 'PENDING',
  "dueDate" TIMESTAMP(3) NOT NULL,
  "assigneeId" TEXT,
  "reminderDays" INTEGER NOT NULL DEFAULT 7,
  "reminderSentAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "completedById" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractObligation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractObligation_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ContractObligation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ContractObligation_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ContractObligation_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ContractObligation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

CREATE INDEX "ContractObligation_contractId_idx" ON "ContractObligation" ("contractId");
CREATE INDEX "ContractObligation_organizationId_status_idx" ON "ContractObligation" ("organizationId", "status");
CREATE INDEX "ContractObligation_status_dueDate_idx" ON "ContractObligation" ("status", "dueDate");

-- CreateTable: ObligationSubTask
CREATE TABLE "ObligationSubTask" (
  "id" TEXT NOT NULL,
  "obligationId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "isCompleted" BOOLEAN NOT NULL DEFAULT false,
  "completedAt" TIMESTAMP(3),
  "completedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ObligationSubTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ObligationSubTask_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "ContractObligation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ObligationSubTask_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ObligationSubTask_obligationId_idx" ON "ObligationSubTask" ("obligationId");

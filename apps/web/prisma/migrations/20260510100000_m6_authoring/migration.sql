-- M6: Authoring
-- Adds ContractDocument (browser-native editor content per contract) and
-- ContractTemplate (org-scoped, reusable templates with variable system),
-- plus 3 new ActivityAction enum values.

-- AlterEnum: ActivityAction additions
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'DOCUMENT_SAVED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'DOCUMENT_IMPORTED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'DOCUMENT_EXPORTED';

-- CreateTable: ContractDocument (Plate JSON per contract)
CREATE TABLE "ContractDocument" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "wordCount" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "savedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractDocument_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ContractDocument_savedById_fkey" FOREIGN KEY ("savedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ContractDocument_contractId_key" ON "ContractDocument" ("contractId");

-- CreateTable: ContractTemplate (org-scoped, with variable system)
CREATE TABLE "ContractTemplate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "contractType" "ContractType",
  "content" JSONB NOT NULL,
  "variables" JSONB NOT NULL,
  "wordCount" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT NOT NULL,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractTemplate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ContractTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "ContractTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

CREATE INDEX "ContractTemplate_organizationId_isArchived_idx" ON "ContractTemplate" ("organizationId", "isArchived");

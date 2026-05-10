-- M9: CRM Integrations
-- Adds CrmIntegration + CrmLink models, CrmProvider enum, and the CRM_*
-- ActivityAction values.

-- CreateEnum: CrmProvider
CREATE TYPE "CrmProvider" AS ENUM ('HUBSPOT', 'SALESFORCE', 'PIPEDRIVE');

-- AlterEnum: extend ActivityAction with CRM events
ALTER TYPE "ActivityAction" ADD VALUE 'CRM_LINKED';
ALTER TYPE "ActivityAction" ADD VALUE 'CRM_UNLINKED';
ALTER TYPE "ActivityAction" ADD VALUE 'CRM_SYNCED';

-- CreateTable: CrmIntegration
CREATE TABLE "CrmIntegration" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" "CrmProvider" NOT NULL,
  "accessToken" TEXT NOT NULL,
  "refreshToken" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "instanceUrl" TEXT,
  "portalId" TEXT,
  "autoCreateStage" TEXT,
  "syncOnActiveStage" TEXT,
  "connectedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmIntegration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CrmIntegration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CrmIntegration_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CrmIntegration_organizationId_provider_key" ON "CrmIntegration" ("organizationId", "provider");
CREATE INDEX "CrmIntegration_organizationId_idx" ON "CrmIntegration" ("organizationId");

-- CreateTable: CrmLink
CREATE TABLE "CrmLink" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "provider" "CrmProvider" NOT NULL,
  "externalDealId" TEXT NOT NULL,
  "externalDealName" TEXT NOT NULL,
  "externalDealUrl" TEXT,
  "lastSyncedAt" TIMESTAMP(3),
  "lastSyncStatus" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CrmLink_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CrmLink_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "CrmIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CrmLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CrmLink_contractId_integrationId_key" ON "CrmLink" ("contractId", "integrationId");
CREATE INDEX "CrmLink_contractId_idx" ON "CrmLink" ("contractId");
CREATE INDEX "CrmLink_integrationId_idx" ON "CrmLink" ("integrationId");
CREATE INDEX "CrmLink_provider_externalDealId_idx" ON "CrmLink" ("provider", "externalDealId");

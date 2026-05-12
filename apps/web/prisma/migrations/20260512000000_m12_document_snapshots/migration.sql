-- M12: Document Snapshots (Redlining)

-- Add new ActivityAction variants
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'SNAPSHOT_CREATED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'SNAPSHOT_DELETED';

-- Create DocumentSnapshot table
CREATE TABLE "DocumentSnapshot" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentSnapshot_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE INDEX "DocumentSnapshot_contractId_createdAt_idx" ON "DocumentSnapshot"("contractId", "createdAt");
CREATE INDEX "DocumentSnapshot_organizationId_idx" ON "DocumentSnapshot"("organizationId");

-- Add foreign keys
ALTER TABLE "DocumentSnapshot" ADD CONSTRAINT "DocumentSnapshot_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentSnapshot" ADD CONSTRAINT "DocumentSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentSnapshot" ADD CONSTRAINT "DocumentSnapshot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

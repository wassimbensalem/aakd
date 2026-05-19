-- AlterTable: add optional actionUrl column to Notification
-- This column was added to schema.prisma but never had a migration generated.
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "actionUrl" TEXT;

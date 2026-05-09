-- M5: Ecosystem Notifications
-- Adds 4 new models for org-level notification channels, outbound webhooks,
-- delivery logs, and per-user email preferences.

-- CreateTable: OrgNotificationChannel (Slack/Teams URLs per org)
CREATE TABLE "OrgNotificationChannel" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "channelType" TEXT NOT NULL,
  "webhookUrl" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrgNotificationChannel_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrgNotificationChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrgNotificationChannel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

CREATE INDEX "OrgNotificationChannel_organizationId_idx" ON "OrgNotificationChannel" ("organizationId");

-- CreateTable: OutboundWebhook (org-registered external endpoints)
CREATE TABLE "OutboundWebhook" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "signingSecret" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutboundWebhook_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OutboundWebhook_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OutboundWebhook_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

CREATE INDEX "OutboundWebhook_organizationId_idx" ON "OutboundWebhook" ("organizationId");

-- CreateTable: WebhookDeliveryLog (per-attempt delivery record)
CREATE TABLE "WebhookDeliveryLog" (
  "id" TEXT NOT NULL,
  "webhookId" TEXT NOT NULL,
  "eventName" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "attempt" INTEGER NOT NULL,
  "httpStatus" INTEGER,
  "responseBody" TEXT,
  "durationMs" INTEGER,
  "status" TEXT NOT NULL,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookDeliveryLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebhookDeliveryLog_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "OutboundWebhook"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "WebhookDeliveryLog_webhookId_idx" ON "WebhookDeliveryLog" ("webhookId");
CREATE INDEX "WebhookDeliveryLog_createdAt_idx" ON "WebhookDeliveryLog" ("createdAt");

-- CreateTable: UserNotificationPreference (per-user, per-event email opt-in)
CREATE TABLE "UserNotificationPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventName" TEXT NOT NULL,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserNotificationPreference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserNotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserNotificationPreference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UserNotificationPreference_userId_organizationId_eventName_key" ON "UserNotificationPreference" ("userId", "organizationId", "eventName");
CREATE INDEX "UserNotificationPreference_userId_organizationId_idx" ON "UserNotificationPreference" ("userId", "organizationId");

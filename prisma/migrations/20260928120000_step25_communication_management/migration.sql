-- CreateEnum
CREATE TYPE "CommunicationMessageType" AS ENUM ('TRANSACTIONAL', 'SECURITY', 'VERIFICATION', 'PROPOSAL', 'MATCHING', 'MEETING', 'SUPPORT', 'FAMILY', 'PAYMENT', 'PRIVACY', 'SYSTEM', 'ADMIN_INTERNAL', 'MARKETING');

-- CreateEnum
CREATE TYPE "CommunicationPurpose" AS ENUM ('ACCOUNT', 'OTP', 'VERIFICATION', 'PROFILE', 'MATCH', 'PROPOSAL', 'CONTACT_PERMISSION', 'MEETING', 'FOLLOWUP', 'SUPPORT', 'PAYMENT', 'PRIVACY', 'SECURITY', 'FAMILY_ACCESS', 'MARKETING', 'ADMIN_INTERNAL');

-- CreateEnum
CREATE TYPE "CommunicationRecipientType" AS ENUM ('PROFILE', 'FAMILY_MEMBER', 'ADMIN');

-- CreateEnum
CREATE TYPE "CommunicationEnvironment" AS ENUM ('DEVELOPMENT', 'STAGING', 'SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "CommunicationFailureClass" AS ENUM ('RETRYABLE', 'PERMANENT', 'POLICY_BLOCKED');

-- CreateEnum
CREATE TYPE "CommunicationTemplateStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CommunicationSuppressionReason" AS ENUM ('USER_REQUEST', 'BOUNCE', 'COMPLAINT', 'UNSUBSCRIBED', 'SECURITY_RESTRICTION', 'ADMIN_RESTRICTION', 'JURISDICTION_RULE', 'PROVIDER_BLOCK', 'TEMPORARY_LIMIT');

-- CreateEnum
CREATE TYPE "CommunicationSuppressionStatus" AS ENUM ('ACTIVE', 'LIFTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CommunicationPolicyKind" AS ENUM ('FREQUENCY', 'QUIET_HOURS', 'JURISDICTION_DEFAULTS', 'FOLLOWUP_RULE', 'ENVIRONMENT');

-- CreateEnum
CREATE TYPE "CommunicationThreadType" AS ENUM ('SUPPORT_THREAD', 'PROPOSAL_COORDINATION', 'MEETING_COORDINATION', 'FAMILY_COORDINATION', 'VERIFICATION_THREAD', 'INTERNAL_ADMIN_THREAD');

-- CreateEnum
CREATE TYPE "CommunicationThreadStatus" AS ENUM ('OPEN', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CommunicationVisibility" AS ENUM ('PUBLIC_TO_USER', 'INTERNAL_ONLY', 'STAFF_SHARED', 'MANAGER_ONLY');

-- CreateEnum
CREATE TYPE "CommunicationCampaignStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CommunicationCampaignRecipientStatus" AS ENUM ('PENDING', 'QUEUED', 'SENT', 'SKIPPED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_SENT';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_BLOCKED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_RETRIED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_DEAD_LETTERED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_TEMPLATE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_TEMPLATE_VERSIONED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_TEMPLATE_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_TEMPLATE_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_TEMPLATE_ACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_TEMPLATE_DISABLED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_CAMPAIGN_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_CAMPAIGN_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_CAMPAIGN_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_CAMPAIGN_STARTED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_CAMPAIGN_PAUSED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_CAMPAIGN_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_CAMPAIGN_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_PROVIDER_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_SUPPRESSION_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_SUPPRESSION_LIFTED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_POLICY_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_THREAD_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_THREAD_MESSAGE';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_WEBHOOK_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_LOG_VIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'COMMUNICATION_QUEUE_PROCESSED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeliveryStatus" ADD VALUE 'BOUNCED';
ALTER TYPE "DeliveryStatus" ADD VALUE 'REJECTED';
ALTER TYPE "DeliveryStatus" ADD VALUE 'EXPIRED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'COMMUNICATION_PROVIDER_ALERT';
ALTER TYPE "NotificationType" ADD VALUE 'COMMUNICATION_REVIEW_REQUIRED';

-- AlterTable
ALTER TABLE "CommunicationLog" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "blockedReason" TEXT,
ADD COLUMN     "bodyEncrypted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bodyRedactedAt" TIMESTAMP(3),
ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "communicationId" TEXT,
ADD COLUMN     "deadLetteredAt" TIMESTAMP(3),
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "failureClass" "CommunicationFailureClass",
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "messageType" "CommunicationMessageType",
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "purpose" "CommunicationPurpose",
ADD COLUMN     "queuedAt" TIMESTAMP(3),
ADD COLUMN     "recipientType" "CommunicationRecipientType" NOT NULL DEFAULT 'PROFILE',
ADD COLUMN     "templateId" TEXT,
ADD COLUMN     "templateVersion" INTEGER,
ADD COLUMN     "threadId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "category" TEXT,
ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'NORMAL';

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "channel" "NotificationChannel",
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "payloadHash" TEXT,
ADD COLUMN     "providerEventId" TEXT,
ADD COLUMN     "signatureValid" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PROCESSED';

-- CreateTable
CREATE TABLE "CommunicationProvider" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "adapter" TEXT NOT NULL,
    "environment" "CommunicationEnvironment" NOT NULL DEFAULT 'PRODUCTION',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "senderIdentity" TEXT,
    "supportedCountries" TEXT NOT NULL DEFAULT '[]',
    "supportedLanguages" TEXT NOT NULL DEFAULT '[]',
    "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 60,
    "retryMaxAttempts" INTEGER NOT NULL DEFAULT 4,
    "retryBaseSeconds" INTEGER NOT NULL DEFAULT 60,
    "secretRefs" TEXT NOT NULL DEFAULT '[]',
    "processorId" TEXT,
    "failoverAllowed" BOOLEAN NOT NULL DEFAULT false,
    "healthStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastWebhookAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationTemplate" (
    "id" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "messageType" "CommunicationMessageType" NOT NULL,
    "purpose" "CommunicationPurpose" NOT NULL,
    "language" "Locale" NOT NULL,
    "eventKey" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variables" TEXT NOT NULL DEFAULT '[]',
    "status" "CommunicationTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "activeVersion" INTEGER,
    "providerTemplateName" TEXT,
    "providerTemplateId" TEXT,
    "providerCategory" TEXT,
    "providerStatus" TEXT,
    "providerSyncedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "previousVersion" INTEGER,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variables" TEXT NOT NULL DEFAULT '[]',
    "status" "CommunicationTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "changeReason" TEXT NOT NULL,
    "changedById" TEXT,
    "approvalId" TEXT,
    "effectiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationSuppression" (
    "id" TEXT NOT NULL,
    "profileId" TEXT,
    "familyMemberId" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "destinationHash" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'ALL',
    "reason" "CommunicationSuppressionReason" NOT NULL,
    "status" "CommunicationSuppressionStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT,
    "liftedById" TEXT,
    "liftedAt" TIMESTAMP(3),
    "liftReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationPolicy" (
    "id" TEXT NOT NULL,
    "kind" "CommunicationPolicyKind" NOT NULL,
    "policyKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "configuration" TEXT NOT NULL,
    "status" "RiskConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "jurisdictionScope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationDeliveryEvent" (
    "id" TEXT NOT NULL,
    "logId" TEXT NOT NULL,
    "provider" TEXT,
    "eventType" TEXT NOT NULL,
    "providerEventId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'SYSTEM',
    "detail" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationDeliveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationThread" (
    "id" TEXT NOT NULL,
    "threadCode" TEXT NOT NULL,
    "type" "CommunicationThreadType" NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "CommunicationThreadStatus" NOT NULL DEFAULT 'OPEN',
    "resourceType" TEXT,
    "resourceId" TEXT,
    "profileId" TEXT,
    "createdById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationThreadMember" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "memberType" TEXT NOT NULL,
    "profileId" TEXT,
    "familyMemberId" TEXT,
    "adminId" TEXT,
    "canReply" BOOLEAN NOT NULL DEFAULT true,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationThreadMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationThreadMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorType" TEXT NOT NULL,
    "authorId" TEXT,
    "visibility" "CommunicationVisibility" NOT NULL DEFAULT 'INTERNAL_ONLY',
    "body" TEXT NOT NULL,
    "bodyEncrypted" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationThreadMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationCampaign" (
    "id" TEXT NOT NULL,
    "campaignCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" "CommunicationPurpose" NOT NULL,
    "messageType" "CommunicationMessageType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "templateId" TEXT NOT NULL,
    "audienceFilter" TEXT NOT NULL,
    "status" "CommunicationCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "estimatedRecipients" INTEGER,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "queuedCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationCampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "status" "CommunicationCampaignRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "skipReason" TEXT,
    "logId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationCampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationProvider_providerKey_key" ON "CommunicationProvider"("providerKey");

-- CreateIndex
CREATE INDEX "CommunicationProvider_channel_active_idx" ON "CommunicationProvider"("channel", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationTemplate_templateCode_key" ON "CommunicationTemplate"("templateCode");

-- CreateIndex
CREATE INDEX "CommunicationTemplate_channel_language_status_idx" ON "CommunicationTemplate"("channel", "language", "status");

-- CreateIndex
CREATE INDEX "CommunicationTemplate_eventKey_channel_language_status_idx" ON "CommunicationTemplate"("eventKey", "channel", "language", "status");

-- CreateIndex
CREATE INDEX "CommunicationTemplate_messageType_status_idx" ON "CommunicationTemplate"("messageType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationTemplateVersion_templateId_version_key" ON "CommunicationTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "CommunicationSuppression_profileId_channel_status_idx" ON "CommunicationSuppression"("profileId", "channel", "status");

-- CreateIndex
CREATE INDEX "CommunicationSuppression_destinationHash_channel_status_idx" ON "CommunicationSuppression"("destinationHash", "channel", "status");

-- CreateIndex
CREATE INDEX "CommunicationSuppression_status_expiresAt_idx" ON "CommunicationSuppression"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "CommunicationPolicy_kind_status_idx" ON "CommunicationPolicy"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationPolicy_kind_policyKey_jurisdictionScope_versio_key" ON "CommunicationPolicy"("kind", "policyKey", "jurisdictionScope", "version");

-- CreateIndex
CREATE INDEX "CommunicationDeliveryEvent_logId_occurredAt_idx" ON "CommunicationDeliveryEvent"("logId", "occurredAt");

-- CreateIndex
CREATE INDEX "CommunicationDeliveryEvent_eventType_createdAt_idx" ON "CommunicationDeliveryEvent"("eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationThread_threadCode_key" ON "CommunicationThread"("threadCode");

-- CreateIndex
CREATE INDEX "CommunicationThread_resourceType_resourceId_idx" ON "CommunicationThread"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "CommunicationThread_profileId_status_idx" ON "CommunicationThread"("profileId", "status");

-- CreateIndex
CREATE INDEX "CommunicationThread_type_status_idx" ON "CommunicationThread"("type", "status");

-- CreateIndex
CREATE INDEX "CommunicationThreadMember_threadId_idx" ON "CommunicationThreadMember"("threadId");

-- CreateIndex
CREATE INDEX "CommunicationThreadMember_profileId_idx" ON "CommunicationThreadMember"("profileId");

-- CreateIndex
CREATE INDEX "CommunicationThreadMember_familyMemberId_idx" ON "CommunicationThreadMember"("familyMemberId");

-- CreateIndex
CREATE INDEX "CommunicationThreadMember_adminId_idx" ON "CommunicationThreadMember"("adminId");

-- CreateIndex
CREATE INDEX "CommunicationThreadMessage_threadId_createdAt_idx" ON "CommunicationThreadMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunicationThreadMessage_visibility_idx" ON "CommunicationThreadMessage"("visibility");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationCampaign_campaignCode_key" ON "CommunicationCampaign"("campaignCode");

-- CreateIndex
CREATE INDEX "CommunicationCampaign_status_idx" ON "CommunicationCampaign"("status");

-- CreateIndex
CREATE INDEX "CommunicationCampaign_createdAt_idx" ON "CommunicationCampaign"("createdAt");

-- CreateIndex
CREATE INDEX "CommunicationCampaignRecipient_campaignId_status_idx" ON "CommunicationCampaignRecipient"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationCampaignRecipient_campaignId_profileId_key" ON "CommunicationCampaignRecipient"("campaignId", "profileId");

-- CreateIndex
CREATE INDEX "CommunicationLog_deliveryStatus_nextAttemptAt_idx" ON "CommunicationLog"("deliveryStatus", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "CommunicationLog_campaignId_idx" ON "CommunicationLog"("campaignId");

-- CreateIndex
CREATE INDEX "CommunicationLog_communicationId_idx" ON "CommunicationLog"("communicationId");

-- CreateIndex
CREATE INDEX "CommunicationLog_deadLetteredAt_idx" ON "CommunicationLog"("deadLetteredAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_providerEventId_idx" ON "WebhookEvent"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "WebhookEvent_createdAt_idx" ON "WebhookEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "CommunicationTemplateVersion" ADD CONSTRAINT "CommunicationTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CommunicationTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationDeliveryEvent" ADD CONSTRAINT "CommunicationDeliveryEvent_logId_fkey" FOREIGN KEY ("logId") REFERENCES "CommunicationLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationThreadMember" ADD CONSTRAINT "CommunicationThreadMember_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommunicationThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationThreadMessage" ADD CONSTRAINT "CommunicationThreadMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "CommunicationThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationCampaignRecipient" ADD CONSTRAINT "CommunicationCampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CommunicationCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;


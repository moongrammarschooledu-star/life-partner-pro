-- CreateEnum
CREATE TYPE "CrmFollowUpType" AS ENUM ('INITIAL_CONTACT', 'PROFILE_REVIEW', 'PROFILE_COMPLETION', 'VERIFICATION', 'MATCH_REVIEW', 'PROPOSAL', 'PROPOSAL_RESPONSE', 'CONTACT_PERMISSION', 'MEETING', 'MEETING_FOLLOWUP', 'FAMILY_COORDINATION', 'SUPPORT', 'PAYMENT', 'RENEWAL', 'DOCUMENT', 'GENERAL');

-- CreateEnum
CREATE TYPE "CrmFollowUpSlaState" AS ENUM ('ON_TRACK', 'DUE_SOON', 'DUE', 'OVERDUE', 'BREACHED', 'PAUSED', 'EXEMPT');

-- CreateEnum
CREATE TYPE "CrmLifecycleStage" AS ENUM ('REGISTERED', 'PROFILE_INCOMPLETE', 'PROFILE_SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_PENDING', 'VERIFIED', 'ACTIVE', 'MATCHING', 'PROPOSAL_ACTIVE', 'WAITING_FOR_RESPONSE', 'MUTUAL_INTEREST', 'CONTACT_COORDINATION', 'MEETING_SCHEDULED', 'MEETING_COMPLETED', 'FOLLOWUP', 'FURTHER_DISCUSSION', 'FINALIZATION_REVIEW', 'FINALIZED', 'MARRIED', 'ON_HOLD', 'NOT_INTERESTED', 'REJECTED', 'DEACTIVATED', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TriggerSource" AS ENUM ('MANUAL', 'AUTOMATION', 'PROFILE_STATUS_SYNC');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WEBSITE', 'SOCIAL_MEDIA', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'WHATSAPP', 'REFERRAL', 'FAMILY_REFERRAL', 'STAFF_REFERRAL', 'DIRECT', 'AD_CAMPAIGN', 'EVENT', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'RESPONDED', 'QUALIFICATION_PENDING', 'QUALIFIED', 'DUPLICATE_REVIEW_REQUIRED', 'REGISTRATION_STARTED', 'REGISTERED', 'CONVERTED', 'NOT_INTERESTED', 'INVALID', 'DUPLICATE', 'DO_NOT_CONTACT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CrmViewType" AS ENUM ('TABLE', 'KANBAN');

-- CreateEnum
CREATE TYPE "CrmAssignmentRule" AS ENUM ('ROUND_ROBIN', 'LEAST_LOADED', 'MANUAL', 'TEAM_BASED', 'SPECIALIZATION', 'GEOGRAPHIC');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AssignmentResourceType" ADD VALUE 'LEAD';
ALTER TYPE "AssignmentResourceType" ADD VALUE 'CRM_RECORD';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AssignmentStatus" ADD VALUE 'UNASSIGNED';
ALTER TYPE "AssignmentStatus" ADD VALUE 'TRANSFERRED';
ALTER TYPE "AssignmentStatus" ADD VALUE 'ON_HOLD';
ALTER TYPE "AssignmentStatus" ADD VALUE 'CLOSED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminTaskType" ADD VALUE 'CRM_LEAD_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'CRM_DUPLICATE_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'CRM_FOLLOWUP_ESCALATION';
ALTER TYPE "AdminTaskType" ADD VALUE 'CRM_STAGE_STALL_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'CRM_MERGE_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'CRM_REASSIGNMENT_REVIEW';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FollowUpStatus" ADD VALUE 'SCHEDULED';
ALTER TYPE "FollowUpStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "FollowUpStatus" ADD VALUE 'WAITING_FOR_USER';
ALTER TYPE "FollowUpStatus" ADD VALUE 'WAITING_FOR_STAFF';
ALTER TYPE "FollowUpStatus" ADD VALUE 'OVERDUE';
ALTER TYPE "FollowUpStatus" ADD VALUE 'ESCALATED';
ALTER TYPE "FollowUpStatus" ADD VALUE 'REOPENED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CRM_RECORD_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CRM_RECORD_EDITED';
ALTER TYPE "AuditAction" ADD VALUE 'CRM_LIFECYCLE_TRANSITIONED';
ALTER TYPE "AuditAction" ADD VALUE 'CRM_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'CRM_REASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'CRM_NOTE_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'CRM_NOTE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'CRM_NOTE_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'CRM_TAG_APPLIED';
ALTER TYPE "AuditAction" ADD VALUE 'CRM_TAG_REMOVED';
ALTER TYPE "AuditAction" ADD VALUE 'LEAD_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'LEAD_CONVERTED';
ALTER TYPE "AuditAction" ADD VALUE 'LEAD_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'CRM_FOLLOWUP_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CRM_FOLLOWUP_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'CRM_SLA_BREACHED';
ALTER TYPE "AuditAction" ADD VALUE 'CRM_MERGE_EXECUTED';
ALTER TYPE "AuditAction" ADD VALUE 'CRM_EXPORT';
ALTER TYPE "AuditAction" ADD VALUE 'CRM_BULK_ACTION';
ALTER TYPE "AuditAction" ADD VALUE 'CRM_SAVED_VIEW_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CRM_AI_SUMMARY_GENERATED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'CRM_FOLLOWUP_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'CRM_FOLLOWUP_OVERDUE';
ALTER TYPE "NotificationType" ADD VALUE 'CRM_STAGE_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'CRM_ASSIGNED_TO_YOU';
ALTER TYPE "NotificationType" ADD VALUE 'CRM_SLA_ESCALATED';
ALTER TYPE "NotificationType" ADD VALUE 'LEAD_ASSIGNED_TO_YOU';

-- AlterEnum
ALTER TYPE "AiFeature" ADD VALUE 'CRM_SUMMARY';

-- AlterTable
ALTER TABLE "FollowUp" ADD COLUMN     "channel" "NotificationChannel",
ADD COLUMN     "crmRecordId" TEXT,
ADD COLUMN     "escalatedTaskId" TEXT,
ADD COLUMN     "followUpCode" TEXT,
ADD COLUMN     "nextAction" TEXT,
ADD COLUMN     "slaState" "CrmFollowUpSlaState",
ADD COLUMN     "type" "CrmFollowUpType";

-- CreateTable
CREATE TABLE "FollowUpReminderConfig" (
    "id" TEXT NOT NULL,
    "followUpType" "CrmFollowUpType" NOT NULL,
    "hoursBeforeDue" INTEGER[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpReminderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpReminderLog" (
    "id" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "hoursBeforeDue" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmRecord" (
    "id" TEXT NOT NULL,
    "crmCode" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "lifecycleStage" "CrmLifecycleStage" NOT NULL DEFAULT 'REGISTERED',
    "leadId" TEXT,
    "leadSource" "LeadSource",
    "assignedStaffId" TEXT,
    "assignedTeamId" TEXT,
    "assignmentStatus" "AssignmentStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "priority" "AssignmentPriority" NOT NULL DEFAULT 'NORMAL',
    "lastActivityAt" TIMESTAMP(3),
    "nextFollowupAt" TIMESTAMP(3),
    "referralId" TEXT,
    "couponId" TEXT,
    "promotionId" TEXT,
    "absorbedProfileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmLifecycleHistory" (
    "id" TEXT NOT NULL,
    "crmRecordId" TEXT NOT NULL,
    "fromStage" "CrmLifecycleStage",
    "toStage" "CrmLifecycleStage" NOT NULL,
    "reason" TEXT,
    "triggeredBy" "TriggerSource" NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmLifecycleHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "leadCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "city" TEXT,
    "area" TEXT,
    "inquiry" TEXT,
    "source" "LeadSource" NOT NULL,
    "campaign" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "assignedStaffId" TEXT,
    "assignedTeamId" TEXT,
    "consentGiven" BOOLEAN NOT NULL DEFAULT false,
    "duplicateOfLeadId" TEXT,
    "convertedProfileId" TEXT,
    "convertedCrmRecordId" TEXT,
    "referralId" TEXT,
    "couponId" TEXT,
    "promotionId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "convertedAt" TIMESTAMP(3),

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadEvent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromStatus" "LeadStatus",
    "toStatus" "LeadStatus" NOT NULL,
    "reason" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmNote" (
    "id" TEXT NOT NULL,
    "crmRecordId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "CommunicationVisibility" NOT NULL DEFAULT 'INTERNAL_ONLY',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmTag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "colorToken" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmRecordTag" (
    "id" TEXT NOT NULL,
    "crmRecordId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "addedById" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmRecordTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmSavedView" (
    "id" TEXT NOT NULL,
    "viewCode" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "filterJson" JSONB NOT NULL,
    "viewType" "CrmViewType" NOT NULL DEFAULT 'TABLE',
    "visibility" "SavedSearchVisibility" NOT NULL DEFAULT 'PRIVATE',
    "departmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmSavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmMergeLink" (
    "id" TEXT NOT NULL,
    "survivorCrmRecordId" TEXT NOT NULL,
    "absorbedProfileId" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "approvalCode" TEXT NOT NULL,
    "movedNotes" INTEGER NOT NULL DEFAULT 0,
    "movedTags" INTEGER NOT NULL DEFAULT 0,
    "movedFollowups" INTEGER NOT NULL DEFAULT 0,
    "movedLeadEvents" INTEGER NOT NULL DEFAULT 0,
    "executedById" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmMergeLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentRuleConfig" (
    "id" TEXT NOT NULL,
    "resourceType" "AssignmentResourceType" NOT NULL,
    "departmentId" TEXT NOT NULL DEFAULT 'GLOBAL',
    "rule" "CrmAssignmentRule" NOT NULL DEFAULT 'MANUAL',
    "lastAssignedId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentRuleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpReminderConfig_followUpType_key" ON "FollowUpReminderConfig"("followUpType");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpReminderLog_followUpId_hoursBeforeDue_key" ON "FollowUpReminderLog"("followUpId", "hoursBeforeDue");

-- CreateIndex
CREATE UNIQUE INDEX "CrmRecord_crmCode_key" ON "CrmRecord"("crmCode");

-- CreateIndex
CREATE UNIQUE INDEX "CrmRecord_profileId_key" ON "CrmRecord"("profileId");

-- CreateIndex
CREATE INDEX "CrmRecord_lifecycleStage_idx" ON "CrmRecord"("lifecycleStage");

-- CreateIndex
CREATE INDEX "CrmRecord_assignedStaffId_idx" ON "CrmRecord"("assignedStaffId");

-- CreateIndex
CREATE INDEX "CrmRecord_priority_nextFollowupAt_idx" ON "CrmRecord"("priority", "nextFollowupAt");

-- CreateIndex
CREATE INDEX "CrmRecord_leadId_idx" ON "CrmRecord"("leadId");

-- CreateIndex
CREATE INDEX "CrmLifecycleHistory_crmRecordId_createdAt_idx" ON "CrmLifecycleHistory"("crmRecordId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_leadCode_key" ON "Lead"("leadCode");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_assignedStaffId_idx" ON "Lead"("assignedStaffId");

-- CreateIndex
CREATE INDEX "Lead_source_idx" ON "Lead"("source");

-- CreateIndex
CREATE INDEX "LeadEvent_leadId_createdAt_idx" ON "LeadEvent"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmNote_crmRecordId_createdAt_idx" ON "CrmNote"("crmRecordId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmTag_name_key" ON "CrmTag"("name");

-- CreateIndex
CREATE INDEX "CrmRecordTag_tagId_idx" ON "CrmRecordTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmRecordTag_crmRecordId_tagId_key" ON "CrmRecordTag"("crmRecordId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmSavedView_viewCode_key" ON "CrmSavedView"("viewCode");

-- CreateIndex
CREATE INDEX "CrmSavedView_ownerId_idx" ON "CrmSavedView"("ownerId");

-- CreateIndex
CREATE INDEX "CrmSavedView_visibility_idx" ON "CrmSavedView"("visibility");

-- CreateIndex
CREATE INDEX "CrmMergeLink_survivorCrmRecordId_idx" ON "CrmMergeLink"("survivorCrmRecordId");

-- CreateIndex
CREATE INDEX "CrmMergeLink_absorbedProfileId_idx" ON "CrmMergeLink"("absorbedProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentRuleConfig_resourceType_departmentId_key" ON "AssignmentRuleConfig"("resourceType", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUp_followUpCode_key" ON "FollowUp"("followUpCode");

-- CreateIndex
CREATE INDEX "FollowUp_crmRecordId_idx" ON "FollowUp"("crmRecordId");

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_crmRecordId_fkey" FOREIGN KEY ("crmRecordId") REFERENCES "CrmRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpReminderLog" ADD CONSTRAINT "FollowUpReminderLog_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "FollowUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmRecord" ADD CONSTRAINT "CrmRecord_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmRecord" ADD CONSTRAINT "CrmRecord_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmLifecycleHistory" ADD CONSTRAINT "CrmLifecycleHistory_crmRecordId_fkey" FOREIGN KEY ("crmRecordId") REFERENCES "CrmRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmNote" ADD CONSTRAINT "CrmNote_crmRecordId_fkey" FOREIGN KEY ("crmRecordId") REFERENCES "CrmRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmRecordTag" ADD CONSTRAINT "CrmRecordTag_crmRecordId_fkey" FOREIGN KEY ("crmRecordId") REFERENCES "CrmRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmRecordTag" ADD CONSTRAINT "CrmRecordTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "CrmTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSavedView" ADD CONSTRAINT "CrmSavedView_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


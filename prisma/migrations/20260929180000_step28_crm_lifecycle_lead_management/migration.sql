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

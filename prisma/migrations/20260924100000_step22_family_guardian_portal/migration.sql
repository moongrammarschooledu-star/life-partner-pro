-- STEP 22 — Family/Guardian Portal, Delegated Access & Multi-User Family
-- Account System. Purely additive: 15 new enums, 9 new tables, 2 new
-- nullable columns on existing tables (AuditLog.actorFamilyMemberId,
-- Notification.recipientFamilyMemberId), and additive enum-value extensions
-- to AdminTaskType/AuditAction/NotificationType. No existing table, column,
-- or enum value is altered or removed.

-- CreateEnum
CREATE TYPE "FamilyRole" AS ENUM ('FAMILY_VIEWER', 'FAMILY_ADVISOR', 'FAMILY_COORDINATOR', 'FAMILY_GUARDIAN', 'FAMILY_APPROVER', 'FAMILY_ADMIN');

-- CreateEnum
CREATE TYPE "FamilyMemberStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FamilyInvitationStatus" AS ENUM ('DRAFT', 'SENT', 'DELIVERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "FamilyAccessLevel" AS ENUM ('VIEW', 'COMMENT', 'SUGGEST', 'RESPOND', 'MANAGE', 'APPROVE');

-- CreateEnum
CREATE TYPE "FamilyAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "FamilyPermissionStatus" AS ENUM ('ACTIVE', 'PENDING_APPROVAL', 'EXPIRED', 'REVOKED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FamilyConsentType" AS ENUM ('FAMILY_INVITATION', 'PROFILE_ACCESS', 'PROPOSAL_SHARING', 'CONTACT_INFORMATION', 'FAMILY_COMMENTS', 'RESPONSE_PARTICIPATION', 'MEETING_COORDINATION', 'FAMILY_COMMUNICATIONS');

-- CreateEnum
CREATE TYPE "FamilyConsentStatus" AS ENUM ('GRANTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FamilyAccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ESCALATED_FOR_ADMIN_APPROVAL', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FamilySharedRecordType" AS ENUM ('PROPOSAL', 'MEETING');

-- CreateEnum
CREATE TYPE "ProposalSharingLevel" AS ENUM ('SUMMARY', 'STANDARD', 'DETAILED', 'RESPONSE_PARTICIPATION');

-- CreateEnum
CREATE TYPE "FamilySharedRecordStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "FamilyDecisionValue" AS ENUM ('INTERESTED', 'NOT_INTERESTED', 'NEED_MORE_INFO');

-- CreateEnum
CREATE TYPE "FamilyDecisionStatus" AS ENUM ('NOT_REQUESTED', 'PENDING_FAMILY_REVIEW', 'FAMILY_INTERESTED', 'FAMILY_NOT_INTERESTED', 'MORE_INFO_REQUESTED', 'APPLICANT_CONFIRMATION_REQUIRED', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FamilyCommentType" AS ENUM ('PROPOSAL_COMMENT', 'PROFILE_SUGGESTION', 'MEETING_COMMENT', 'GENERAL_FAMILY_NOTE');

-- CreateEnum
CREATE TYPE "FamilyCommentTargetType" AS ENUM ('PROPOSAL', 'MEETING', 'PROFILE');

-- CreateEnum
CREATE TYPE "FamilyCommentVisibility" AS ENUM ('APPLICANT_ONLY', 'FAMILY_SHARED', 'ADMIN_SHARED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminTaskType" ADD VALUE 'FAMILY_INVITATION_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'FAMILY_ACCESS_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'FAMILY_PERMISSION_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'FAMILY_CONTACT_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'FAMILY_PROPOSAL_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'FAMILY_DECISION_CONFIRMATION';
ALTER TYPE "AdminTaskType" ADD VALUE 'FAMILY_SECURITY_REVIEW';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_INVITATION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_INVITATION_RESENT';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_INVITATION_ACCEPTED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_INVITATION_DECLINED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_INVITATION_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_MEMBER_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_MEMBER_LOGIN';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_PERMISSION_GRANTED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_PERMISSION_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_PERMISSION_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_ACCESS_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_ACCESS_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_ACCESS_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_PROPOSAL_VIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_PROPOSAL_SHARED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_RESPONSE_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_DECISION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_DECISION_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_CONTACT_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_ACCESS_EXPIRED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_MEMBER_REMOVED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_MEMBER_SUSPENDED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_COMMENT_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_MEETING_ACTION';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_SESSION_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_LOGIN_FAILED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'FAMILY_INVITATION';
ALTER TYPE "NotificationType" ADD VALUE 'FAMILY_ACCESS_GRANTED';
ALTER TYPE "NotificationType" ADD VALUE 'FAMILY_ACCESS_REVOKED';
ALTER TYPE "NotificationType" ADD VALUE 'FAMILY_ACCESS_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE 'FAMILY_PROPOSAL_SHARED';
ALTER TYPE "NotificationType" ADD VALUE 'FAMILY_PROPOSAL_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE 'FAMILY_DECISION_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'FAMILY_MEETING_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE 'FAMILY_PERMISSION_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE 'FAMILY_PERMISSION_EXPIRED';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorFamilyMemberId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "recipientFamilyMemberId" TEXT;

-- CreateTable
CREATE TABLE "FamilyAccount" (
    "id" TEXT NOT NULL,
    "familyCode" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "status" "FamilyAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyGroup" (
    "id" TEXT NOT NULL,
    "groupCode" TEXT NOT NULL,
    "familyAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FamilyGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyMember" (
    "id" TEXT NOT NULL,
    "familyAccountId" TEXT NOT NULL,
    "groupId" TEXT,
    "fullName" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "email" TEXT,
    "mobile" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "mobileVerified" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT NOT NULL,
    "role" "FamilyRole" NOT NULL DEFAULT 'FAMILY_VIEWER',
    "status" "FamilyMemberStatus" NOT NULL DEFAULT 'PENDING',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyMemberSession" (
    "id" TEXT NOT NULL,
    "familyMemberId" TEXT NOT NULL,
    "deviceInfo" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "FamilyMemberSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyInvitation" (
    "id" TEXT NOT NULL,
    "invitationCode" TEXT NOT NULL,
    "familyAccountId" TEXT NOT NULL,
    "invitedName" TEXT NOT NULL,
    "invitedEmail" TEXT,
    "invitedMobile" TEXT,
    "relationship" TEXT NOT NULL,
    "requestedRole" "FamilyRole" NOT NULL DEFAULT 'FAMILY_VIEWER',
    "tokenHash" TEXT NOT NULL,
    "status" "FamilyInvitationStatus" NOT NULL DEFAULT 'SENT',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "familyMemberId" TEXT,

    CONSTRAINT "FamilyInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyPermission" (
    "id" TEXT NOT NULL,
    "familyMemberId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "scope" TEXT,
    "status" "FamilyPermissionStatus" NOT NULL DEFAULT 'ACTIVE',
    "grantedByProfileId" TEXT,
    "grantedByAdminId" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "FamilyPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyConsent" (
    "id" TEXT NOT NULL,
    "familyMemberId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "consentType" "FamilyConsentType" NOT NULL,
    "scope" TEXT,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "status" "FamilyConsentStatus" NOT NULL DEFAULT 'GRANTED',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "FamilyConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyAccessRequest" (
    "id" TEXT NOT NULL,
    "requestCode" TEXT NOT NULL,
    "familyMemberId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "requestedPermission" TEXT NOT NULL,
    "reason" TEXT,
    "status" "FamilyAccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FamilyAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilySharedRecord" (
    "id" TEXT NOT NULL,
    "familyMemberId" TEXT NOT NULL,
    "recordType" "FamilySharedRecordType" NOT NULL,
    "recordId" TEXT NOT NULL,
    "accessLevel" "ProposalSharingLevel" NOT NULL DEFAULT 'SUMMARY',
    "allowComments" BOOLEAN NOT NULL DEFAULT false,
    "allowResponse" BOOLEAN NOT NULL DEFAULT false,
    "sharedByProfileId" TEXT NOT NULL,
    "sharedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "status" "FamilySharedRecordStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "FamilySharedRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyDecision" (
    "id" TEXT NOT NULL,
    "decisionCode" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "familyMemberId" TEXT NOT NULL,
    "decision" "FamilyDecisionValue" NOT NULL,
    "comment" TEXT,
    "status" "FamilyDecisionStatus" NOT NULL DEFAULT 'PENDING_FAMILY_REVIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "FamilyDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyComment" (
    "id" TEXT NOT NULL,
    "familyMemberId" TEXT NOT NULL,
    "commentType" "FamilyCommentType" NOT NULL,
    "targetType" "FamilyCommentTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "FamilyCommentVisibility" NOT NULL DEFAULT 'APPLICANT_ONLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FamilyComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FamilyAccount_familyCode_key" ON "FamilyAccount"("familyCode");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyAccount_applicantId_key" ON "FamilyAccount"("applicantId");

-- CreateIndex
CREATE INDEX "FamilyAccount_applicantId_idx" ON "FamilyAccount"("applicantId");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyGroup_groupCode_key" ON "FamilyGroup"("groupCode");

-- CreateIndex
CREATE INDEX "FamilyGroup_familyAccountId_idx" ON "FamilyGroup"("familyAccountId");

-- CreateIndex
CREATE INDEX "FamilyMember_familyAccountId_idx" ON "FamilyMember"("familyAccountId");

-- CreateIndex
CREATE INDEX "FamilyMember_email_idx" ON "FamilyMember"("email");

-- CreateIndex
CREATE INDEX "FamilyMember_status_idx" ON "FamilyMember"("status");

-- CreateIndex
CREATE INDEX "FamilyMemberSession_familyMemberId_idx" ON "FamilyMemberSession"("familyMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyInvitation_invitationCode_key" ON "FamilyInvitation"("invitationCode");

-- CreateIndex
CREATE INDEX "FamilyInvitation_familyAccountId_idx" ON "FamilyInvitation"("familyAccountId");

-- CreateIndex
CREATE INDEX "FamilyInvitation_status_idx" ON "FamilyInvitation"("status");

-- CreateIndex
CREATE INDEX "FamilyPermission_familyMemberId_idx" ON "FamilyPermission"("familyMemberId");

-- CreateIndex
CREATE INDEX "FamilyPermission_status_idx" ON "FamilyPermission"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyPermission_familyMemberId_permission_scope_key" ON "FamilyPermission"("familyMemberId", "permission", "scope");

-- CreateIndex
CREATE INDEX "FamilyConsent_familyMemberId_consentType_idx" ON "FamilyConsent"("familyMemberId", "consentType");

-- CreateIndex
CREATE INDEX "FamilyConsent_applicantId_idx" ON "FamilyConsent"("applicantId");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyAccessRequest_requestCode_key" ON "FamilyAccessRequest"("requestCode");

-- CreateIndex
CREATE INDEX "FamilyAccessRequest_familyMemberId_idx" ON "FamilyAccessRequest"("familyMemberId");

-- CreateIndex
CREATE INDEX "FamilyAccessRequest_applicantId_status_idx" ON "FamilyAccessRequest"("applicantId", "status");

-- CreateIndex
CREATE INDEX "FamilySharedRecord_familyMemberId_status_idx" ON "FamilySharedRecord"("familyMemberId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FamilySharedRecord_familyMemberId_recordType_recordId_key" ON "FamilySharedRecord"("familyMemberId", "recordType", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyDecision_decisionCode_key" ON "FamilyDecision"("decisionCode");

-- CreateIndex
CREATE INDEX "FamilyDecision_proposalId_idx" ON "FamilyDecision"("proposalId");

-- CreateIndex
CREATE INDEX "FamilyDecision_familyMemberId_idx" ON "FamilyDecision"("familyMemberId");

-- CreateIndex
CREATE INDEX "FamilyComment_familyMemberId_idx" ON "FamilyComment"("familyMemberId");

-- CreateIndex
CREATE INDEX "FamilyComment_targetType_targetId_idx" ON "FamilyComment"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_actorFamilyMemberId_idx" ON "AuditLog"("actorFamilyMemberId");

-- CreateIndex
CREATE INDEX "Notification_recipientFamilyMemberId_readAt_createdAt_idx" ON "Notification"("recipientFamilyMemberId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorFamilyMemberId_fkey" FOREIGN KEY ("actorFamilyMemberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientFamilyMemberId_fkey" FOREIGN KEY ("recipientFamilyMemberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyAccount" ADD CONSTRAINT "FamilyAccount_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyGroup" ADD CONSTRAINT "FamilyGroup_familyAccountId_fkey" FOREIGN KEY ("familyAccountId") REFERENCES "FamilyAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_familyAccountId_fkey" FOREIGN KEY ("familyAccountId") REFERENCES "FamilyAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "FamilyGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyMemberSession" ADD CONSTRAINT "FamilyMemberSession_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyInvitation" ADD CONSTRAINT "FamilyInvitation_familyAccountId_fkey" FOREIGN KEY ("familyAccountId") REFERENCES "FamilyAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyPermission" ADD CONSTRAINT "FamilyPermission_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyConsent" ADD CONSTRAINT "FamilyConsent_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyConsent" ADD CONSTRAINT "FamilyConsent_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyAccessRequest" ADD CONSTRAINT "FamilyAccessRequest_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilySharedRecord" ADD CONSTRAINT "FamilySharedRecord_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyDecision" ADD CONSTRAINT "FamilyDecision_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyDecision" ADD CONSTRAINT "FamilyDecision_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyComment" ADD CONSTRAINT "FamilyComment_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

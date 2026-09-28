-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RiskState" AS ENUM ('NOT_ASSESSED', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNDER_REVIEW', 'CLEARED', 'RESTRICTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RiskConfidence" AS ENUM ('EXACT', 'VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "RiskSignalCategory" AS ENUM ('IDENTITY', 'CONTACT', 'ACCOUNT', 'DUPLICATE', 'DOCUMENT', 'LOGIN_SECURITY', 'PROFILE_ACTIVITY', 'COMMUNICATION', 'PROPOSAL_ACTIVITY', 'MEETING_ACTIVITY', 'PAYMENT', 'PRIVACY', 'FAMILY_ACCESS', 'ADMIN_ACCESS', 'DEVICE', 'NETWORK', 'AUTOMATION', 'ABUSE', 'SAFETY');

-- CreateEnum
CREATE TYPE "RiskCaseStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'UNDER_INVESTIGATION', 'INFORMATION_REQUESTED', 'ESCALATED', 'CLEARED', 'RESTRICTED', 'SUSPENDED', 'DISMISSED', 'FALSE_POSITIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "RiskReviewDecisionType" AS ENUM ('ACKNOWLEDGE', 'INVESTIGATE', 'REQUEST_INFORMATION', 'REQUEST_REVERIFICATION', 'DISMISS', 'MARK_FALSE_POSITIVE', 'CLEAR', 'RESTRICT', 'SUSPEND', 'ESCALATE', 'CLOSE');

-- CreateEnum
CREATE TYPE "RiskEvidenceType" AS ENUM ('VERIFICATION_RESULT', 'AUDIT_EVENT', 'LOGIN_EVENT', 'SECURITY_EVENT', 'PROFILE_CHANGE', 'CONTACT_CHANGE', 'API_EVENT', 'PAYMENT_EVENT', 'SUPPORT_CASE', 'USER_REPORT', 'ADMIN_NOTE', 'PROVIDER_RESULT');

-- CreateEnum
CREATE TYPE "FalsePositiveReason" AS ENUM ('SHARED_FAMILY_DEVICE', 'SHARED_FAMILY_PHONE', 'SHARED_HOME_NETWORK', 'DATA_ENTRY_ERROR', 'PROVIDER_ERROR', 'LEGITIMATE_DUPLICATE_CONTEXT', 'INCORRECT_SIGNAL', 'OTHER');

-- CreateEnum
CREATE TYPE "RiskConfigStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('ACCOUNT_CREATED', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'OTP_REQUESTED', 'OTP_FAILED', 'PASSWORD_RESET', 'PROFILE_UPDATED', 'CONTACT_UPDATED', 'VERIFICATION_STARTED', 'VERIFICATION_FAILED', 'DOCUMENT_UPLOADED', 'PROPOSAL_CREATED', 'CONTACT_REQUESTED', 'FAMILY_INVITE_CREATED', 'FAMILY_ACCESS_REQUESTED', 'PAYMENT_FAILED', 'ADMIN_SENSITIVE_ACCESS', 'API_AUTH_FAILURE', 'PERMISSION_DENIED', 'CONTACT_BYPASS_ATTEMPT', 'NEW_DEVICE_SESSION');

-- CreateEnum
CREATE TYPE "SecurityIncidentControl" AS ENUM ('SESSION_REVOCATION', 'SUBJECT_THROTTLE', 'IP_BLOCK', 'OTP_THROTTLE', 'LOGIN_PROTECTION');

-- CreateEnum
CREATE TYPE "SecurityIncidentStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'LIFTED');

-- CreateEnum
CREATE TYPE "DuplicateClusterStatus" AS ENUM ('UNRESOLVED', 'CONFIRMED', 'FALSE_POSITIVE', 'RESOLVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "UserReportType" AS ENUM ('SUSPICIOUS_PROFILE', 'INAPPROPRIATE_COMMUNICATION', 'IDENTITY_CONCERN', 'CONTACT_ABUSE', 'HARASSMENT', 'IMPERSONATION', 'OTHER');

-- CreateEnum
CREATE TYPE "UserReportStatus" AS ENUM ('RECEIVED', 'UNDER_REVIEW', 'ACTION_TAKEN', 'NO_ACTION_NEEDED', 'CLOSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AccountRelationshipType" ADD VALUE 'LIKELY_DUPLICATE';
ALTER TYPE "AccountRelationshipType" ADD VALUE 'RELATED_ACCOUNT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminTaskType" ADD VALUE 'RISK_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'ADMIN_SECURITY_REVIEW';

-- AlterEnum
ALTER TYPE "AiFeature" ADD VALUE 'RISK_CASE_SUMMARY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'RISK_CASE_OPENED';
ALTER TYPE "AuditAction" ADD VALUE 'RISK_CASE_ACTION';
ALTER TYPE "AuditAction" ADD VALUE 'RISK_ASSESSMENT_RECORDED';
ALTER TYPE "AuditAction" ADD VALUE 'RISK_RULE_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'RISK_CONFIGURATION_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'RISK_EVIDENCE_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'RISK_EVIDENCE_VIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'RISK_RESTRICTION_APPLIED';
ALTER TYPE "AuditAction" ADD VALUE 'RISK_DUPLICATE_CLUSTER_REBUILT';
ALTER TYPE "AuditAction" ADD VALUE 'RISK_TECHNICAL_CONTROL_APPLIED';
ALTER TYPE "AuditAction" ADD VALUE 'RISK_ADMIN_ACCESS_ANOMALY';
ALTER TYPE "AuditAction" ADD VALUE 'USER_REPORT_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'USER_REPORT_REVIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'RATE_LIMIT_POLICY_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_RISK_SUMMARY_GENERATED';

-- AlterEnum
ALTER TYPE "DataCategory" ADD VALUE 'RISK_EVIDENCE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DuplicateConfidenceBand" ADD VALUE 'EXACT';
ALTER TYPE "DuplicateConfidenceBand" ADD VALUE 'VERY_HIGH';
ALTER TYPE "DuplicateConfidenceBand" ADD VALUE 'HIGH';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'HIGH_RISK_DETECTED';
ALTER TYPE "NotificationType" ADD VALUE 'CRITICAL_RISK_DETECTED';
ALTER TYPE "NotificationType" ADD VALUE 'DUPLICATE_REVIEW_REQUIRED';
ALTER TYPE "NotificationType" ADD VALUE 'VERIFICATION_RISK';
ALTER TYPE "NotificationType" ADD VALUE 'ACCOUNT_SECURITY_ALERT';
ALTER TYPE "NotificationType" ADD VALUE 'CONTACT_BYPASS_DETECTED';
ALTER TYPE "NotificationType" ADD VALUE 'ADMIN_ACCESS_ANOMALY';
ALTER TYPE "NotificationType" ADD VALUE 'SAFETY_REPORT_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'RISK_REVIEW_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'RISK_CASE_ESCALATED';
ALTER TYPE "NotificationType" ADD VALUE 'RISK_INFORMATION_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'SECURITY_NOTICE';
ALTER TYPE "NotificationType" ADD VALUE 'SAFETY_REPORT_ACKNOWLEDGED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RestrictionType" ADD VALUE 'COMMUNICATION_RESTRICTED';
ALTER TYPE "RestrictionType" ADD VALUE 'PAYMENT_RESTRICTED';
ALTER TYPE "RestrictionType" ADD VALUE 'FAMILY_ACCESS_RESTRICTED';
ALTER TYPE "RestrictionType" ADD VALUE 'FULL_ACCOUNT_RESTRICTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityFlagStatus" ADD VALUE 'ACKNOWLEDGED';
ALTER TYPE "SecurityFlagStatus" ADD VALUE 'CONFIRMED';
ALTER TYPE "SecurityFlagStatus" ADD VALUE 'FALSE_POSITIVE';
ALTER TYPE "SecurityFlagStatus" ADD VALUE 'ESCALATED';
ALTER TYPE "SecurityFlagStatus" ADD VALUE 'ARCHIVED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityFlagType" ADD VALUE 'LOGIN_ABUSE_SIGNAL';
ALTER TYPE "SecurityFlagType" ADD VALUE 'OTP_ABUSE_SIGNAL';
ALTER TYPE "SecurityFlagType" ADD VALUE 'CONTACT_BYPASS_ATTEMPT';
ALTER TYPE "SecurityFlagType" ADD VALUE 'UNUSUAL_PRIVILEGED_ACCESS';
ALTER TYPE "SecurityFlagType" ADD VALUE 'FAMILY_ACCESS_ABUSE_SIGNAL';
ALTER TYPE "SecurityFlagType" ADD VALUE 'SHARED_DEVICE_SIGNAL';
ALTER TYPE "SecurityFlagType" ADD VALUE 'UNUSUAL_NETWORK_ACTIVITY';
ALTER TYPE "SecurityFlagType" ADD VALUE 'PROFILE_CHURN_SIGNAL';
ALTER TYPE "SecurityFlagType" ADD VALUE 'IDENTITY_VERIFICATION_REVIEW';
ALTER TYPE "SecurityFlagType" ADD VALUE 'SAFETY_REPORT_SIGNAL';
ALTER TYPE "SecurityFlagType" ADD VALUE 'REPEATED_PAYMENT_FAILURE';
ALTER TYPE "SecurityFlagType" ADD VALUE 'UNAUTHORIZED_ACCESS_ATTEMPT';

-- AlterTable
ALTER TABLE "DuplicateCandidate" ADD COLUMN     "falsePositiveReason" "FalsePositiveReason";

-- AlterTable
ALTER TABLE "ProfileRestriction" ADD COLUMN     "approvalId" TEXT,
ADD COLUMN     "isPermanent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "riskCaseId" TEXT,
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "SecurityFlag" ADD COLUMN     "category" "RiskSignalCategory",
ADD COLUMN     "confidence" "RiskConfidence",
ADD COLUMN     "dedupKey" TEXT,
ADD COLUMN     "evidenceRef" TEXT,
ADD COLUMN     "falsePositiveReason" "FalsePositiveReason",
ADD COLUMN     "reviewRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "riskCaseId" TEXT,
ADD COLUMN     "ruleVersion" INTEGER,
ADD COLUMN     "signalCode" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "RiskCase" (
    "id" TEXT NOT NULL,
    "riskCode" TEXT NOT NULL,
    "subjectProfileId" TEXT,
    "subjectAdminId" TEXT,
    "category" "RiskSignalCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "RiskCaseStatus" NOT NULL DEFAULT 'OPEN',
    "riskLevel" "RiskLevel" NOT NULL,
    "riskState" "RiskState" NOT NULL DEFAULT 'UNDER_REVIEW',
    "reviewRequired" BOOLEAN NOT NULL DEFAULT true,
    "assignedToId" TEXT,
    "jurisdictionId" TEXT,
    "caseId" TEXT,
    "userReportId" TEXT,
    "openedBy" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "outcome" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskCaseEvent" (
    "id" TEXT NOT NULL,
    "riskCaseId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorAdminId" TEXT,
    "summary" TEXT NOT NULL,
    "payload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskCaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAssessment" (
    "id" TEXT NOT NULL,
    "riskCaseId" TEXT,
    "subjectProfileId" TEXT,
    "riskLevel" "RiskLevel" NOT NULL,
    "score" INTEGER,
    "topSignals" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "rulesTriggered" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "configurationVersion" INTEGER NOT NULL,
    "confidence" "RiskConfidence" NOT NULL,
    "cappedBySingleSignal" BOOLEAN NOT NULL DEFAULT false,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "decision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskEvidence" (
    "id" TEXT NOT NULL,
    "riskCaseId" TEXT,
    "evidenceType" "RiskEvidenceType" NOT NULL,
    "source" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" TEXT,
    "contentHash" TEXT NOT NULL,
    "retentionClass" TEXT NOT NULL DEFAULT 'RISK_EVIDENCE',
    "createdById" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskReview" (
    "id" TEXT NOT NULL,
    "riskCaseId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" "RiskReviewDecisionType" NOT NULL,
    "notes" TEXT,
    "checklist" TEXT,
    "approvalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskRule" (
    "id" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category" "RiskSignalCategory",
    "description" TEXT,
    "configuration" TEXT NOT NULL,
    "status" "RiskConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "jurisdictionScope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskFactor" (
    "id" TEXT NOT NULL,
    "factorKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category" "RiskSignalCategory" NOT NULL,
    "description" TEXT,
    "weight" INTEGER NOT NULL,
    "severity" "SecurityFlagSeverity" NOT NULL DEFAULT 'MEDIUM',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "immediateControl" BOOLEAN NOT NULL DEFAULT false,
    "status" "RiskConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "jurisdictionScope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "eventType" "SecurityEventType" NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'app',
    "profileId" TEXT,
    "adminId" TEXT,
    "familyMemberId" TEXT,
    "subjectKey" TEXT,
    "ipHash" TEXT,
    "userAgentHash" TEXT,
    "outcome" TEXT,
    "meta" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityIncident" (
    "id" TEXT NOT NULL,
    "controlType" "SecurityIncidentControl" NOT NULL,
    "status" "SecurityIncidentStatus" NOT NULL DEFAULT 'ACTIVE',
    "subjectType" TEXT NOT NULL,
    "subjectRef" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "riskCaseId" TEXT,
    "createdById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "liftedAt" TIMESTAMP(3),
    "liftedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitPolicy" (
    "id" TEXT NOT NULL,
    "policyKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "limit" INTEGER NOT NULL,
    "windowSeconds" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "RiskConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateCluster" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" "DuplicateClusterStatus" NOT NULL DEFAULT 'UNRESOLVED',
    "confidenceBand" "DuplicateConfidenceBand" NOT NULL,
    "memberCount" INTEGER NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuplicateCluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateClusterMember" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateClusterMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserReport" (
    "id" TEXT NOT NULL,
    "reportCode" TEXT NOT NULL,
    "reportType" "UserReportType" NOT NULL,
    "reporterProfileId" TEXT NOT NULL,
    "reportedProfileId" TEXT,
    "description" TEXT NOT NULL,
    "status" "UserReportStatus" NOT NULL DEFAULT 'RECEIVED',
    "caseId" TEXT,
    "riskCaseId" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RiskCase_riskCode_key" ON "RiskCase"("riskCode");

-- CreateIndex
CREATE INDEX "RiskCase_subjectProfileId_status_idx" ON "RiskCase"("subjectProfileId", "status");

-- CreateIndex
CREATE INDEX "RiskCase_subjectAdminId_idx" ON "RiskCase"("subjectAdminId");

-- CreateIndex
CREATE INDEX "RiskCase_status_riskLevel_idx" ON "RiskCase"("status", "riskLevel");

-- CreateIndex
CREATE INDEX "RiskCase_category_status_idx" ON "RiskCase"("category", "status");

-- CreateIndex
CREATE INDEX "RiskCase_jurisdictionId_idx" ON "RiskCase"("jurisdictionId");

-- CreateIndex
CREATE INDEX "RiskCase_createdAt_idx" ON "RiskCase"("createdAt");

-- CreateIndex
CREATE INDEX "RiskCaseEvent_riskCaseId_createdAt_idx" ON "RiskCaseEvent"("riskCaseId", "createdAt");

-- CreateIndex
CREATE INDEX "RiskAssessment_subjectProfileId_createdAt_idx" ON "RiskAssessment"("subjectProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "RiskAssessment_riskCaseId_idx" ON "RiskAssessment"("riskCaseId");

-- CreateIndex
CREATE INDEX "RiskAssessment_riskLevel_createdAt_idx" ON "RiskAssessment"("riskLevel", "createdAt");

-- CreateIndex
CREATE INDEX "RiskEvidence_riskCaseId_idx" ON "RiskEvidence"("riskCaseId");

-- CreateIndex
CREATE INDEX "RiskEvidence_evidenceType_createdAt_idx" ON "RiskEvidence"("evidenceType", "createdAt");

-- CreateIndex
CREATE INDEX "RiskReview_riskCaseId_createdAt_idx" ON "RiskReview"("riskCaseId", "createdAt");

-- CreateIndex
CREATE INDEX "RiskRule_ruleKey_status_idx" ON "RiskRule"("ruleKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiskRule_ruleKey_jurisdictionScope_version_key" ON "RiskRule"("ruleKey", "jurisdictionScope", "version");

-- CreateIndex
CREATE INDEX "RiskFactor_factorKey_status_idx" ON "RiskFactor"("factorKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiskFactor_factorKey_jurisdictionScope_version_key" ON "RiskFactor"("factorKey", "jurisdictionScope", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityEvent_idempotencyKey_key" ON "SecurityEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SecurityEvent_eventType_createdAt_idx" ON "SecurityEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_profileId_eventType_createdAt_idx" ON "SecurityEvent"("profileId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_adminId_eventType_createdAt_idx" ON "SecurityEvent"("adminId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_subjectKey_eventType_createdAt_idx" ON "SecurityEvent"("subjectKey", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_ipHash_eventType_createdAt_idx" ON "SecurityEvent"("ipHash", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityIncident_status_expiresAt_idx" ON "SecurityIncident"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "SecurityIncident_subjectType_subjectRef_status_idx" ON "SecurityIncident"("subjectType", "subjectRef", "status");

-- CreateIndex
CREATE INDEX "RateLimitPolicy_policyKey_status_idx" ON "RateLimitPolicy"("policyKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitPolicy_policyKey_version_key" ON "RateLimitPolicy"("policyKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateCluster_fingerprint_key" ON "DuplicateCluster"("fingerprint");

-- CreateIndex
CREATE INDEX "DuplicateCluster_status_idx" ON "DuplicateCluster"("status");

-- CreateIndex
CREATE INDEX "DuplicateClusterMember_profileId_idx" ON "DuplicateClusterMember"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateClusterMember_clusterId_profileId_key" ON "DuplicateClusterMember"("clusterId", "profileId");

-- CreateIndex
CREATE UNIQUE INDEX "UserReport_reportCode_key" ON "UserReport"("reportCode");

-- CreateIndex
CREATE INDEX "UserReport_reporterProfileId_createdAt_idx" ON "UserReport"("reporterProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "UserReport_reportedProfileId_createdAt_idx" ON "UserReport"("reportedProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "UserReport_status_idx" ON "UserReport"("status");

-- CreateIndex
CREATE INDEX "ProfileRestriction_riskCaseId_idx" ON "ProfileRestriction"("riskCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityFlag_signalCode_key" ON "SecurityFlag"("signalCode");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityFlag_dedupKey_key" ON "SecurityFlag"("dedupKey");

-- CreateIndex
CREATE INDEX "SecurityFlag_riskCaseId_idx" ON "SecurityFlag"("riskCaseId");

-- CreateIndex
CREATE INDEX "SecurityFlag_category_status_idx" ON "SecurityFlag"("category", "status");

-- CreateIndex
CREATE INDEX "SecurityFlag_flagType_createdAt_idx" ON "SecurityFlag"("flagType", "createdAt");

-- AddForeignKey
ALTER TABLE "SecurityFlag" ADD CONSTRAINT "SecurityFlag_riskCaseId_fkey" FOREIGN KEY ("riskCaseId") REFERENCES "RiskCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskCaseEvent" ADD CONSTRAINT "RiskCaseEvent_riskCaseId_fkey" FOREIGN KEY ("riskCaseId") REFERENCES "RiskCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_riskCaseId_fkey" FOREIGN KEY ("riskCaseId") REFERENCES "RiskCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskEvidence" ADD CONSTRAINT "RiskEvidence_riskCaseId_fkey" FOREIGN KEY ("riskCaseId") REFERENCES "RiskCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskReview" ADD CONSTRAINT "RiskReview_riskCaseId_fkey" FOREIGN KEY ("riskCaseId") REFERENCES "RiskCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateClusterMember" ADD CONSTRAINT "DuplicateClusterMember_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "DuplicateCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;


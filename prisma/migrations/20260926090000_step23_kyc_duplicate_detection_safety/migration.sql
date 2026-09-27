-- CreateEnum
CREATE TYPE "DuplicateConfidenceBand" AS ENUM ('STRONG', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "DuplicateCandidateStatus" AS ENUM ('POTENTIAL_DUPLICATE', 'DUPLICATE_REVIEW_REQUIRED', 'CONFIRMED_DUPLICATE', 'NOT_DUPLICATE', 'RESOLVED');

-- CreateEnum
CREATE TYPE "AccountRelationshipType" AS ENUM ('POTENTIAL_DUPLICATE', 'CONFIRMED_DUPLICATE', 'FAMILY_RELATED', 'AUTHORIZED_FAMILY_ACCOUNT', 'SHARED_CONTACT_SIGNAL', 'SHARED_VERIFICATION_SIGNAL', 'UNKNOWN_RELATIONSHIP');

-- CreateEnum
CREATE TYPE "AccountRelationshipStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VerificationPolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminTaskType" ADD VALUE 'DUPLICATE_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'RISK_SIGNAL_REVIEW';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'VERIFICATION_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'DUPLICATE_MATCH_DETECTED';
ALTER TYPE "AuditAction" ADD VALUE 'DUPLICATE_CANDIDATE_REVIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'DUPLICATE_CONFIRMED';
ALTER TYPE "AuditAction" ADD VALUE 'DUPLICATE_DISMISSED';
ALTER TYPE "AuditAction" ADD VALUE 'ACCOUNT_RELATIONSHIP_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'RISK_SIGNAL_DETECTED';
ALTER TYPE "AuditAction" ADD VALUE 'RISK_SIGNAL_REVIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'RISK_SIGNAL_RESOLVED';
ALTER TYPE "AuditAction" ADD VALUE 'VERIFICATION_DOCUMENT_DOWNLOADED';
ALTER TYPE "AuditAction" ADD VALUE 'VERIFICATION_POLICY_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'PROVIDER_SESSION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PROVIDER_WEBHOOK_RECEIVED';
ALTER TYPE "AuditAction" ADD VALUE 'PROVIDER_WEBHOOK_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'REVERIFICATION_TRIGGERED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'ADMIN_HIGH_RISK_SIGNAL';
ALTER TYPE "NotificationType" ADD VALUE 'ADMIN_REVERIFICATION_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'PROVIDER_VERIFICATION_FAILURE';
ALTER TYPE "NotificationType" ADD VALUE 'KYC_VERIFICATION_REQUIRES_ACTION';
ALTER TYPE "NotificationType" ADD VALUE 'KYC_VERIFICATION_COMPLETED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RestrictionType" ADD VALUE 'VERIFICATION_REQUIRED';
ALTER TYPE "RestrictionType" ADD VALUE 'NO_NEW_PROPOSALS';
ALTER TYPE "RestrictionType" ADD VALUE 'LOGIN_RESTRICTED';
ALTER TYPE "RestrictionType" ADD VALUE 'NO_FAMILY_INVITATIONS';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityFlagType" ADD VALUE 'RAPID_REGISTRATION_SIGNAL';
ALTER TYPE "SecurityFlagType" ADD VALUE 'CONTACT_REUSE_SIGNAL';
ALTER TYPE "SecurityFlagType" ADD VALUE 'EXCESSIVE_PROPOSAL_ACTIVITY';
ALTER TYPE "SecurityFlagType" ADD VALUE 'ABNORMAL_CONTACT_REQUEST_ACTIVITY';
ALTER TYPE "SecurityFlagType" ADD VALUE 'PAYMENT_ANOMALY_SIGNAL';

-- AlterTable
ALTER TABLE "ProfileVerification" ADD COLUMN     "providerName" TEXT,
ADD COLUMN     "providerReference" TEXT,
ADD COLUMN     "providerSessionId" TEXT,
ADD COLUMN     "providerStatus" TEXT;

-- CreateTable
CREATE TABLE "DuplicateCandidate" (
    "id" TEXT NOT NULL,
    "candidateCode" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "candidateProfileId" TEXT NOT NULL,
    "securityFlagId" TEXT,
    "confidenceBand" "DuplicateConfidenceBand" NOT NULL,
    "confidenceScore" INTEGER NOT NULL,
    "matchingSignals" TEXT NOT NULL,
    "status" "DuplicateCandidateStatus" NOT NULL DEFAULT 'POTENTIAL_DUPLICATE',
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuplicateCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountRelationship" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "relatedProfileId" TEXT NOT NULL,
    "relationshipType" "AccountRelationshipType" NOT NULL,
    "confidenceBand" "DuplicateConfidenceBand",
    "source" TEXT NOT NULL,
    "status" "AccountRelationshipStatus" NOT NULL DEFAULT 'ACTIVE',
    "evidenceRef" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationPolicy" (
    "id" TEXT NOT NULL,
    "policyKey" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL DEFAULT 1,
    "configuration" TEXT NOT NULL,
    "status" "VerificationPolicyStatus" NOT NULL DEFAULT 'ACTIVE',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationProviderEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateCandidate_candidateCode_key" ON "DuplicateCandidate"("candidateCode");

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateCandidate_securityFlagId_key" ON "DuplicateCandidate"("securityFlagId");

-- CreateIndex
CREATE INDEX "DuplicateCandidate_profileId_idx" ON "DuplicateCandidate"("profileId");

-- CreateIndex
CREATE INDEX "DuplicateCandidate_candidateProfileId_idx" ON "DuplicateCandidate"("candidateProfileId");

-- CreateIndex
CREATE INDEX "DuplicateCandidate_status_idx" ON "DuplicateCandidate"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateCandidate_profileId_candidateProfileId_key" ON "DuplicateCandidate"("profileId", "candidateProfileId");

-- CreateIndex
CREATE INDEX "AccountRelationship_profileId_idx" ON "AccountRelationship"("profileId");

-- CreateIndex
CREATE INDEX "AccountRelationship_relatedProfileId_idx" ON "AccountRelationship"("relatedProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountRelationship_profileId_relatedProfileId_relationship_key" ON "AccountRelationship"("profileId", "relatedProfileId", "relationshipType");

-- CreateIndex
CREATE INDEX "VerificationPolicy_policyKey_status_idx" ON "VerificationPolicy"("policyKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationProviderEvent_providerEventId_key" ON "VerificationProviderEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "VerificationProviderEvent_provider_eventType_idx" ON "VerificationProviderEvent"("provider", "eventType");

-- AddForeignKey
ALTER TABLE "DuplicateCandidate" ADD CONSTRAINT "DuplicateCandidate_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateCandidate" ADD CONSTRAINT "DuplicateCandidate_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateCandidate" ADD CONSTRAINT "DuplicateCandidate_securityFlagId_fkey" FOREIGN KEY ("securityFlagId") REFERENCES "SecurityFlag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateCandidate" ADD CONSTRAINT "DuplicateCandidate_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountRelationship" ADD CONSTRAINT "AccountRelationship_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountRelationship" ADD CONSTRAINT "AccountRelationship_relatedProfileId_fkey" FOREIGN KEY ("relatedProfileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountRelationship" ADD CONSTRAINT "AccountRelationship_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountRelationship" ADD CONSTRAINT "AccountRelationship_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationPolicy" ADD CONSTRAINT "VerificationPolicy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;


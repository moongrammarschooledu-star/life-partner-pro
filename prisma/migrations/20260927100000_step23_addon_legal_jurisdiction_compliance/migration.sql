-- CreateEnum
CREATE TYPE "JurisdictionStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DRAFT');

-- CreateEnum
CREATE TYPE "ComplianceRuleStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'RETIRED');

-- CreateEnum
CREATE TYPE "ComplianceSourceType" AS ENUM ('LAW', 'REGULATION', 'REGULATOR_GUIDANCE', 'COURT_DECISION', 'CONTRACT', 'PROVIDER_REQUIREMENT', 'INTERNAL_POLICY', 'LEGAL_COUNSEL_ADVICE');

-- CreateEnum
CREATE TYPE "LegalBasis" AS ENUM ('CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'LEGITIMATE_INTEREST', 'VITAL_INTEREST', 'PUBLIC_TASK', 'OTHER_CONFIGURED_BASIS');

-- CreateEnum
CREATE TYPE "DataProcessingPurpose" AS ENUM ('ACCOUNT_OPERATION', 'IDENTITY_VERIFICATION', 'SECURITY', 'MATCHMAKING', 'PROPOSAL_MANAGEMENT', 'CONTACT_SHARING', 'CUSTOMER_SUPPORT', 'PAYMENT_PROCESSING', 'LEGAL_COMPLIANCE', 'FRAUD_PREVENTION', 'SAFETY', 'ANALYTICS', 'AI_ASSISTANCE');

-- CreateEnum
CREATE TYPE "ComplianceReviewStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'LEGAL_REVIEW', 'COMPLIANCE_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('ALLOWED', 'ALLOWED_WITH_CONTROLS', 'REVIEW_REQUIRED', 'BLOCKED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AuthorityRequestType" AS ENUM ('LAW_ENFORCEMENT', 'REGULATOR', 'COURT_ORDER', 'LEGAL_NOTICE', 'OTHER_AUTHORITY');

-- CreateEnum
CREATE TYPE "LegalDocumentType" AS ENUM ('PRIVACY_POLICY', 'TERMS_OF_SERVICE', 'CONSENT_NOTICE', 'VERIFICATION_NOTICE', 'COOKIE_NOTICE', 'AI_PROCESSING_NOTICE', 'FAMILY_SHARING_NOTICE', 'PAYMENT_NOTICE');

-- CreateEnum
CREATE TYPE "DataHoldStatus" AS ENUM ('ACTIVE', 'RELEASE_PENDING', 'RELEASED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "AdminRole" ADD VALUE 'COMPLIANCE_MANAGER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminTaskType" ADD VALUE 'COMPLIANCE_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'JURISDICTION_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'AUTHORITY_REQUEST_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'TRANSFER_REVIEW';

-- AlterEnum
ALTER TYPE "AiFeature" ADD VALUE 'COMPLIANCE_SUMMARY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'AI_COMPLIANCE_SUMMARY_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE 'JURISDICTION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'JURISDICTION_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'COMPLIANCE_RULE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'COMPLIANCE_RULE_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'COMPLIANCE_REVIEW_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'TRANSFER_ASSESSED';
ALTER TYPE "AuditAction" ADD VALUE 'TRANSFER_BLOCKED';
ALTER TYPE "AuditAction" ADD VALUE 'PROCESSOR_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PROCESSOR_REVIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'PROCESSOR_AGREEMENT_RECORDED';
ALTER TYPE "AuditAction" ADD VALUE 'AUTHORITY_REQUEST_RECEIVED';
ALTER TYPE "AuditAction" ADD VALUE 'AUTHORITY_REQUEST_VERIFIED';
ALTER TYPE "AuditAction" ADD VALUE 'AUTHORITY_REQUEST_DISCLOSED';
ALTER TYPE "AuditAction" ADD VALUE 'LEGAL_HOLD_RELEASE_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'LEGAL_HOLD_RELEASE_EXECUTED';
ALTER TYPE "AuditAction" ADD VALUE 'COMPLIANCE_INCIDENT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'LEGAL_DOCUMENT_VERSION_PUBLISHED';
ALTER TYPE "AuditAction" ADD VALUE 'AGE_VERIFICATION_BLOCKED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CaseCategory" ADD VALUE 'UNAUTHORIZED_DISCLOSURE';
ALTER TYPE "CaseCategory" ADD VALUE 'WRONG_JURISDICTION_CONFIGURATION';
ALTER TYPE "CaseCategory" ADD VALUE 'INCORRECT_RETENTION';
ALTER TYPE "CaseCategory" ADD VALUE 'UNAUTHORIZED_DOCUMENT_ACCESS';
ALTER TYPE "CaseCategory" ADD VALUE 'PROVIDER_TRANSFER_ISSUE';
ALTER TYPE "CaseCategory" ADD VALUE 'PRIVACY_REQUEST_FAILURE';
ALTER TYPE "CaseCategory" ADD VALUE 'POLICY_CONFLICT';
ALTER TYPE "CaseCategory" ADD VALUE 'ACCIDENTAL_SENSITIVE_DATA_EXPOSURE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'COMPLIANCE_RULE_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE 'COMPLIANCE_RULE_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE 'COMPLIANCE_JURISDICTION_UNKNOWN';
ALTER TYPE "NotificationType" ADD VALUE 'COMPLIANCE_TRANSFER_REVIEW_REQUIRED';
ALTER TYPE "NotificationType" ADD VALUE 'COMPLIANCE_PROVIDER_REVIEW_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'COMPLIANCE_LEGAL_HOLD_ACTIVE';
ALTER TYPE "NotificationType" ADD VALUE 'COMPLIANCE_POLICY_CONFLICT';
ALTER TYPE "NotificationType" ADD VALUE 'COMPLIANCE_AUTHORITY_REQUEST_DUE';

-- AlterTable
ALTER TABLE "ConsentGrant" ADD COLUMN     "jurisdictionId" TEXT,
ADD COLUMN     "legalBasis" "LegalBasis" DEFAULT 'CONSENT',
ADD COLUMN     "method" TEXT,
ADD COLUMN     "privacyNoticeVersionId" TEXT,
ADD COLUMN     "purpose" "DataProcessingPurpose",
ADD COLUMN     "withdrawnAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DataHold" ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "authority" TEXT,
ADD COLUMN     "dataClasses" TEXT,
ADD COLUMN     "holdStatus" "DataHoldStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "scope" TEXT;

-- CreateTable
CREATE TABLE "Jurisdiction" (
    "id" TEXT NOT NULL,
    "jurisdictionCode" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "regionCode" TEXT,
    "name" TEXT NOT NULL,
    "status" "JurisdictionStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "configuration" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Jurisdiction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceRule" (
    "id" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "requirementType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceType" "ComplianceSourceType" NOT NULL,
    "sourceTitle" TEXT,
    "sourceAuthority" TEXT,
    "sourceReference" TEXT,
    "sourceUrl" TEXT,
    "sourcePublicationDate" TIMESTAMP(3),
    "internalReviewNote" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "reviewDate" TIMESTAMP(3),
    "status" "ComplianceRuleStatus" NOT NULL DEFAULT 'DRAFT',
    "ruleVersion" INTEGER NOT NULL DEFAULT 1,
    "configuration" TEXT NOT NULL,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvalDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceReview" (
    "id" TEXT NOT NULL,
    "reviewCode" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "status" "ComplianceReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewType" TEXT,
    "notes" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reviewerId" TEXT,
    "approvalId" TEXT,
    "ruleRefId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataTransferAssessment" (
    "id" TEXT NOT NULL,
    "assessmentCode" TEXT NOT NULL,
    "sourceJurisdictionId" TEXT,
    "destJurisdictionId" TEXT,
    "dataClass" "DataClassification" NOT NULL,
    "dataType" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "provider" TEXT,
    "storageLocation" TEXT,
    "transferMechanism" TEXT,
    "userConsentRequired" BOOLEAN NOT NULL DEFAULT false,
    "userConsentObtained" BOOLEAN NOT NULL DEFAULT false,
    "contractualControls" TEXT,
    "governingRuleId" TEXT,
    "status" "TransferStatus" NOT NULL DEFAULT 'UNKNOWN',
    "assessedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataTransferAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceProcessor" (
    "id" TEXT NOT NULL,
    "processorCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "legalEntity" TEXT,
    "country" TEXT NOT NULL,
    "processingRegions" TEXT NOT NULL,
    "dataTypes" TEXT NOT NULL,
    "subprocessors" TEXT,
    "transferMechanism" TEXT,
    "contractStatus" TEXT NOT NULL DEFAULT 'NOT_RECORDED',
    "complianceStatus" TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "lastReviewedAt" TIMESTAMP(3),
    "nextReviewDue" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceProcessor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessorAgreement" (
    "id" TEXT NOT NULL,
    "agreementCode" TEXT NOT NULL,
    "processorId" TEXT NOT NULL,
    "agreementType" TEXT NOT NULL,
    "agreementStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "effectiveDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "jurisdictionId" TEXT,
    "dataCategories" TEXT NOT NULL,
    "subprocessorTerms" TEXT,
    "securityTerms" TEXT,
    "transferTerms" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessorAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorityRequest" (
    "id" TEXT NOT NULL,
    "requestCode" TEXT NOT NULL,
    "requestType" "AuthorityRequestType" NOT NULL,
    "authority" TEXT NOT NULL,
    "jurisdictionId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestReference" TEXT,
    "scope" TEXT NOT NULL,
    "deadline" TIMESTAMP(3),
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "legalReviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedDisclosureScope" TEXT,
    "disclosedData" TEXT,
    "disclosureDate" TIMESTAMP(3),
    "reviewerId" TEXT,
    "approvalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthorityRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalDocumentVersion" (
    "id" TEXT NOT NULL,
    "documentType" "LegalDocumentType" NOT NULL,
    "version" TEXT NOT NULL,
    "jurisdictionId" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retirementDate" TIMESTAMP(3),
    "language" TEXT NOT NULL DEFAULT 'EN',
    "contentReference" TEXT NOT NULL,
    "approvalStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Jurisdiction_jurisdictionCode_key" ON "Jurisdiction"("jurisdictionCode");

-- CreateIndex
CREATE INDEX "Jurisdiction_status_idx" ON "Jurisdiction"("status");

-- CreateIndex
CREATE INDEX "Jurisdiction_countryCode_idx" ON "Jurisdiction"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceRule_ruleCode_key" ON "ComplianceRule"("ruleCode");

-- CreateIndex
CREATE INDEX "ComplianceRule_jurisdictionId_status_idx" ON "ComplianceRule"("jurisdictionId", "status");

-- CreateIndex
CREATE INDEX "ComplianceRule_status_effectiveFrom_effectiveTo_idx" ON "ComplianceRule"("status", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "ComplianceRule_requirementType_idx" ON "ComplianceRule"("requirementType");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceReview_reviewCode_key" ON "ComplianceReview"("reviewCode");

-- CreateIndex
CREATE INDEX "ComplianceReview_subjectType_subjectId_idx" ON "ComplianceReview"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "ComplianceReview_status_dueDate_idx" ON "ComplianceReview"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "DataTransferAssessment_assessmentCode_key" ON "DataTransferAssessment"("assessmentCode");

-- CreateIndex
CREATE INDEX "DataTransferAssessment_status_idx" ON "DataTransferAssessment"("status");

-- CreateIndex
CREATE INDEX "DataTransferAssessment_sourceJurisdictionId_destJurisdictio_idx" ON "DataTransferAssessment"("sourceJurisdictionId", "destJurisdictionId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceProcessor_processorCode_key" ON "ComplianceProcessor"("processorCode");

-- CreateIndex
CREATE INDEX "ComplianceProcessor_serviceType_idx" ON "ComplianceProcessor"("serviceType");

-- CreateIndex
CREATE INDEX "ComplianceProcessor_complianceStatus_idx" ON "ComplianceProcessor"("complianceStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessorAgreement_agreementCode_key" ON "ProcessorAgreement"("agreementCode");

-- CreateIndex
CREATE INDEX "ProcessorAgreement_processorId_idx" ON "ProcessorAgreement"("processorId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorityRequest_requestCode_key" ON "AuthorityRequest"("requestCode");

-- CreateIndex
CREATE INDEX "AuthorityRequest_requestType_legalReviewStatus_idx" ON "AuthorityRequest"("requestType", "legalReviewStatus");

-- CreateIndex
CREATE INDEX "AuthorityRequest_jurisdictionId_idx" ON "AuthorityRequest"("jurisdictionId");

-- CreateIndex
CREATE INDEX "LegalDocumentVersion_documentType_jurisdictionId_language_idx" ON "LegalDocumentVersion"("documentType", "jurisdictionId", "language");

-- AddForeignKey
ALTER TABLE "ConsentGrant" ADD CONSTRAINT "ConsentGrant_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentGrant" ADD CONSTRAINT "ConsentGrant_privacyNoticeVersionId_fkey" FOREIGN KEY ("privacyNoticeVersionId") REFERENCES "LegalDocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataHold" ADD CONSTRAINT "DataHold_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceRule" ADD CONSTRAINT "ComplianceRule_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceRule" ADD CONSTRAINT "ComplianceRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceRule" ADD CONSTRAINT "ComplianceRule_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceReview" ADD CONSTRAINT "ComplianceReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceReview" ADD CONSTRAINT "ComplianceReview_ruleRefId_fkey" FOREIGN KEY ("ruleRefId") REFERENCES "ComplianceRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceReview" ADD CONSTRAINT "ComplianceReview_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataTransferAssessment" ADD CONSTRAINT "DataTransferAssessment_sourceJurisdictionId_fkey" FOREIGN KEY ("sourceJurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataTransferAssessment" ADD CONSTRAINT "DataTransferAssessment_destJurisdictionId_fkey" FOREIGN KEY ("destJurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataTransferAssessment" ADD CONSTRAINT "DataTransferAssessment_governingRuleId_fkey" FOREIGN KEY ("governingRuleId") REFERENCES "ComplianceRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataTransferAssessment" ADD CONSTRAINT "DataTransferAssessment_assessedById_fkey" FOREIGN KEY ("assessedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessorAgreement" ADD CONSTRAINT "ProcessorAgreement_processorId_fkey" FOREIGN KEY ("processorId") REFERENCES "ComplianceProcessor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessorAgreement" ADD CONSTRAINT "ProcessorAgreement_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessorAgreement" ADD CONSTRAINT "ProcessorAgreement_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorityRequest" ADD CONSTRAINT "AuthorityRequest_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorityRequest" ADD CONSTRAINT "AuthorityRequest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalDocumentVersion" ADD CONSTRAINT "LegalDocumentVersion_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalDocumentVersion" ADD CONSTRAINT "LegalDocumentVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateEnum
CREATE TYPE "DocumentClassification" AS ENUM ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'HIGHLY_SENSITIVE', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "DocumentOwnerType" AS ENUM ('PROFILE', 'FAMILY_MEMBER', 'PROPOSAL', 'SUPPORT_CASE', 'RISK_CASE', 'PRIVACY_REQUEST', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADING', 'UPLOADED', 'SCANNING', 'AVAILABLE', 'UNDER_REVIEW', 'VERIFIED', 'PARTIALLY_VERIFIED', 'REJECTED', 'EXPIRED', 'REVERIFICATION_REQUIRED', 'RESTRICTED', 'QUARANTINED', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "DocumentUploaderType" AS ENUM ('PROFILE', 'FAMILY_MEMBER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "DocumentScanStatus" AS ENUM ('PENDING', 'SCANNING', 'CLEAN', 'INFECTED', 'SUSPICIOUS', 'SCAN_FAILED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "DocumentQuarantineDecision" AS ENUM ('PENDING', 'RELEASED', 'DESTROYED');

-- CreateEnum
CREATE TYPE "DocumentShareRecipientType" AS ENUM ('FAMILY_MEMBER', 'ADMIN', 'PROFILE');

-- CreateEnum
CREATE TYPE "DocumentShareScope" AS ENUM ('VIEW', 'DOWNLOAD');

-- CreateEnum
CREATE TYPE "DocumentShareStatus" AS ENUM ('REQUESTED', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'EXPIRED', 'REVOKED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentRequestStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'UPLOADED', 'UNDER_REVIEW', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DocumentSignatureStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'PARTIALLY_SIGNED', 'SIGNED', 'DECLINED', 'EXPIRED', 'VOIDED', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentSignatureRecipientStatus" AS ENUM ('PENDING', 'SENT', 'VIEWED', 'SIGNED', 'DECLINED');

-- CreateEnum
CREATE TYPE "DocumentAccessAction" AS ENUM ('VIEW', 'PREVIEW', 'DOWNLOAD', 'SHARE', 'VERIFY', 'REJECT', 'APPROVE', 'REDACT', 'EXPORT', 'DELETE', 'RESTORE');

-- CreateEnum
CREATE TYPE "DocumentVerificationStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'UNDER_REVIEW', 'VERIFIED', 'PARTIALLY_VERIFIED', 'REJECTED', 'REVERIFICATION_REQUIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminTaskType" ADD VALUE 'DOCUMENT_REVIEW_TASK';
ALTER TYPE "AdminTaskType" ADD VALUE 'DOCUMENT_REQUEST_FOLLOWUP';
ALTER TYPE "AdminTaskType" ADD VALUE 'DOCUMENT_REVERIFICATION_TASK';
ALTER TYPE "AdminTaskType" ADD VALUE 'DOCUMENT_SECURITY_TASK';
ALTER TYPE "AdminTaskType" ADD VALUE 'DOCUMENT_SHARE_APPROVAL_TASK';

-- AlterEnum
ALTER TYPE "AssignmentResourceType" ADD VALUE 'DOCUMENT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_VIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_PREVIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_DOWNLOADED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_VERSION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_REVERIFICATION_REQUIRED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_RESTRICTED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_ARCHIVED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_RESTORED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_QUARANTINED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_RELEASED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_SHARE_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_SHARE_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_SHARE_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_SHARE_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_SHARE_ACCESSED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_REQUEST_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_REQUEST_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_SIGNATURE_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_SIGNATURE_SIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_SIGNATURE_DECLINED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_SIGNATURE_VOIDED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_REDACTED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_EXPORTED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_PACKAGE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_INTEGRITY_ERROR';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_LEGAL_HOLD_PLACED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_LEGAL_HOLD_LIFTED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_TYPE_CONFIG_CHANGED';

-- AlterEnum
ALTER TYPE "DataCategory" ADD VALUE 'DOCUMENT_RECORDS';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'DOCUMENT_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'DOCUMENT_REVIEW_DECIDED';
ALTER TYPE "NotificationType" ADD VALUE 'DOCUMENT_EXPIRING_SOON';
ALTER TYPE "NotificationType" ADD VALUE 'DOCUMENT_REVERIFICATION_REQUIRED';
ALTER TYPE "NotificationType" ADD VALUE 'DOCUMENT_SHARE_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE 'DOCUMENT_SIGNATURE_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE 'ADMIN_DOCUMENT_REVIEW_QUEUE';
ALTER TYPE "NotificationType" ADD VALUE 'ADMIN_DOCUMENT_SECURITY_ALERT';

-- AlterEnum
ALTER TYPE "RestrictionType" ADD VALUE 'DOCUMENT_ACCESS_RESTRICTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityEventType" ADD VALUE 'DOCUMENT_UPLOAD_REJECTED';
ALTER TYPE "SecurityEventType" ADD VALUE 'DOCUMENT_SCAN_SUSPICIOUS';
ALTER TYPE "SecurityEventType" ADD VALUE 'DOCUMENT_TAMPER_DETECTED';
ALTER TYPE "SecurityEventType" ADD VALUE 'DOCUMENT_UNAUTHORIZED_ACCESS';
ALTER TYPE "SecurityEventType" ADD VALUE 'DOCUMENT_SHARE_ANOMALY';


-- CreateTable
CREATE TABLE "DocumentCategoryConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "defaultClassification" "DocumentClassification" NOT NULL DEFAULT 'RESTRICTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentCategoryConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTypeConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "defaultClassification" "DocumentClassification" NOT NULL DEFAULT 'RESTRICTED',
    "requiresExpiry" BOOLEAN NOT NULL DEFAULT false,
    "acceptedMimeTypes" TEXT NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTypeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "documentCode" TEXT NOT NULL,
    "ownerType" "DocumentOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "profileId" TEXT,
    "typeKey" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "classification" "DocumentClassification" NOT NULL DEFAULT 'RESTRICTED',
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADING',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "secureStorageReference" TEXT NOT NULL,
    "ivBase64" TEXT NOT NULL,
    "authTagBase64" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "uploaderType" "DocumentUploaderType" NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "verificationStatus" "DocumentVerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "verificationMethod" TEXT,
    "verificationProvider" TEXT,
    "verificationReference" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "verificationReason" TEXT,
    "verificationNotes" TEXT,
    "verificationVersion" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "softDeletedAt" TIMESTAMP(3),
    "bodyRedactedAt" TIMESTAMP(3),
    "proposalId" TEXT,
    "caseId" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "previousVersion" INTEGER,
    "secureStorageReference" TEXT NOT NULL,
    "ivBase64" TEXT NOT NULL,
    "authTagBase64" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "uploaderType" "DocumentUploaderType" NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "changeReason" TEXT,
    "scanStatus" "DocumentScanStatus" NOT NULL DEFAULT 'PENDING',
    "verificationStatus" "DocumentVerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSecurityScan" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "DocumentScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanner" TEXT NOT NULL,
    "findings" TEXT NOT NULL DEFAULT '[]',
    "scannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentSecurityScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentQuarantine" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "decision" "DocumentQuarantineDecision" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentQuarantine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentAccessLog" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "action" "DocumentAccessAction" NOT NULL,
    "actorType" "DocumentUploaderType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "purpose" TEXT,
    "result" TEXT NOT NULL,
    "denialReason" TEXT,
    "ipHash" TEXT,
    "userAgentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentShare" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "recipientType" "DocumentShareRecipientType" NOT NULL,
    "recipientId" TEXT NOT NULL,
    "scope" "DocumentShareScope" NOT NULL DEFAULT 'VIEW',
    "purpose" TEXT NOT NULL,
    "status" "DocumentShareStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "approvalId" TEXT,
    "watermarked" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRequest" (
    "id" TEXT NOT NULL,
    "requestCode" TEXT NOT NULL,
    "typeKey" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "requestedFromType" "DocumentUploaderType" NOT NULL,
    "requestedFromId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "instructions" TEXT,
    "assignedToId" TEXT,
    "status" "DocumentRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "resultingDocumentId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRequestEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorType" "DocumentUploaderType",
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentRequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSignatureRequest" (
    "id" TEXT NOT NULL,
    "signCode" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'LOCAL',
    "status" "DocumentSignatureStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedById" TEXT NOT NULL,
    "message" TEXT,
    "expiresAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "signedDocumentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSignatureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSignatureRecipient" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "recipientType" "DocumentUploaderType" NOT NULL,
    "recipientId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 1,
    "status" "DocumentSignatureRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "viewedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "signedName" TEXT,
    "ipHash" TEXT,

    CONSTRAINT "DocumentSignatureRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSignatureEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "recipientType" "DocumentUploaderType",
    "recipientId" TEXT,
    "documentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentSignatureEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRedaction" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "redactedVersion" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "regions" TEXT NOT NULL,
    "redactedById" TEXT NOT NULL,
    "approvalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentRedaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVerificationEvent" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reasonKey" TEXT,
    "note" TEXT,
    "actorId" TEXT,
    "approvalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVerificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentPackage" (
    "id" TEXT NOT NULL,
    "packageCode" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ownerType" "DocumentOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentPackageItem" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "excludeReason" TEXT,

    CONSTRAINT "DocumentPackageItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentOcrResult" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "extractedText" TEXT,
    "fields" TEXT NOT NULL DEFAULT '{}',
    "detectedType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentOcrResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentCategoryConfig_key_key" ON "DocumentCategoryConfig"("key");

-- CreateIndex
CREATE INDEX "DocumentCategoryConfig_active_idx" ON "DocumentCategoryConfig"("active");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTypeConfig_key_key" ON "DocumentTypeConfig"("key");

-- CreateIndex
CREATE INDEX "DocumentTypeConfig_categoryKey_active_idx" ON "DocumentTypeConfig"("categoryKey", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Document_documentCode_key" ON "Document"("documentCode");

-- CreateIndex
CREATE INDEX "Document_ownerType_ownerId_idx" ON "Document"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "Document_profileId_status_idx" ON "Document"("profileId", "status");

-- CreateIndex
CREATE INDEX "Document_typeKey_idx" ON "Document"("typeKey");

-- CreateIndex
CREATE INDEX "Document_categoryKey_idx" ON "Document"("categoryKey");

-- CreateIndex
CREATE INDEX "Document_status_idx" ON "Document"("status");

-- CreateIndex
CREATE INDEX "Document_classification_idx" ON "Document"("classification");

-- CreateIndex
CREATE INDEX "Document_expiresAt_idx" ON "Document"("expiresAt");

-- CreateIndex
CREATE INDEX "Document_fileHash_idx" ON "Document"("fileHash");

-- CreateIndex
CREATE INDEX "Document_requestId_idx" ON "Document"("requestId");

-- CreateIndex
CREATE INDEX "DocumentVersion_documentId_idx" ON "DocumentVersion"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_version_key" ON "DocumentVersion"("documentId", "version");

-- CreateIndex
CREATE INDEX "DocumentSecurityScan_documentId_version_idx" ON "DocumentSecurityScan"("documentId", "version");

-- CreateIndex
CREATE INDEX "DocumentSecurityScan_status_idx" ON "DocumentSecurityScan"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentQuarantine_scanId_key" ON "DocumentQuarantine"("scanId");

-- CreateIndex
CREATE INDEX "DocumentQuarantine_documentId_idx" ON "DocumentQuarantine"("documentId");

-- CreateIndex
CREATE INDEX "DocumentQuarantine_decision_idx" ON "DocumentQuarantine"("decision");

-- CreateIndex
CREATE INDEX "DocumentAccessLog_documentId_createdAt_idx" ON "DocumentAccessLog"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentAccessLog_actorType_actorId_idx" ON "DocumentAccessLog"("actorType", "actorId");

-- CreateIndex
CREATE INDEX "DocumentAccessLog_action_idx" ON "DocumentAccessLog"("action");

-- CreateIndex
CREATE INDEX "DocumentShare_documentId_status_idx" ON "DocumentShare"("documentId", "status");

-- CreateIndex
CREATE INDEX "DocumentShare_recipientType_recipientId_idx" ON "DocumentShare"("recipientType", "recipientId");

-- CreateIndex
CREATE INDEX "DocumentShare_status_expiresAt_idx" ON "DocumentShare"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRequest_requestCode_key" ON "DocumentRequest"("requestCode");

-- CreateIndex
CREATE INDEX "DocumentRequest_requestedFromType_requestedFromId_idx" ON "DocumentRequest"("requestedFromType", "requestedFromId");

-- CreateIndex
CREATE INDEX "DocumentRequest_status_idx" ON "DocumentRequest"("status");

-- CreateIndex
CREATE INDEX "DocumentRequest_assignedToId_idx" ON "DocumentRequest"("assignedToId");

-- CreateIndex
CREATE INDEX "DocumentRequestEvent_requestId_createdAt_idx" ON "DocumentRequestEvent"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSignatureRequest_signCode_key" ON "DocumentSignatureRequest"("signCode");

-- CreateIndex
CREATE INDEX "DocumentSignatureRequest_documentId_idx" ON "DocumentSignatureRequest"("documentId");

-- CreateIndex
CREATE INDEX "DocumentSignatureRequest_status_idx" ON "DocumentSignatureRequest"("status");

-- CreateIndex
CREATE INDEX "DocumentSignatureRecipient_requestId_status_idx" ON "DocumentSignatureRecipient"("requestId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSignatureRecipient_requestId_recipientType_recipien_key" ON "DocumentSignatureRecipient"("requestId", "recipientType", "recipientId");

-- CreateIndex
CREATE INDEX "DocumentSignatureEvent_requestId_createdAt_idx" ON "DocumentSignatureEvent"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentRedaction_documentId_idx" ON "DocumentRedaction"("documentId");

-- CreateIndex
CREATE INDEX "DocumentVerificationEvent_documentId_createdAt_idx" ON "DocumentVerificationEvent"("documentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentPackage_packageCode_key" ON "DocumentPackage"("packageCode");

-- CreateIndex
CREATE INDEX "DocumentPackage_ownerType_ownerId_idx" ON "DocumentPackage"("ownerType", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentPackageItem_packageId_documentId_key" ON "DocumentPackageItem"("packageId", "documentId");

-- CreateIndex
CREATE INDEX "DocumentOcrResult_documentId_idx" ON "DocumentOcrResult"("documentId");

-- AddForeignKey
ALTER TABLE "DocumentTypeConfig" ADD CONSTRAINT "DocumentTypeConfig_categoryKey_fkey" FOREIGN KEY ("categoryKey") REFERENCES "DocumentCategoryConfig"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_typeKey_fkey" FOREIGN KEY ("typeKey") REFERENCES "DocumentTypeConfig"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSecurityScan" ADD CONSTRAINT "DocumentSecurityScan_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentQuarantine" ADD CONSTRAINT "DocumentQuarantine_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "DocumentSecurityScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAccessLog" ADD CONSTRAINT "DocumentAccessLog_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentShare" ADD CONSTRAINT "DocumentShare_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRequestEvent" ADD CONSTRAINT "DocumentRequestEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "DocumentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSignatureRequest" ADD CONSTRAINT "DocumentSignatureRequest_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSignatureRecipient" ADD CONSTRAINT "DocumentSignatureRecipient_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "DocumentSignatureRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSignatureEvent" ADD CONSTRAINT "DocumentSignatureEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "DocumentSignatureRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRedaction" ADD CONSTRAINT "DocumentRedaction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVerificationEvent" ADD CONSTRAINT "DocumentVerificationEvent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPackageItem" ADD CONSTRAINT "DocumentPackageItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "DocumentPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;


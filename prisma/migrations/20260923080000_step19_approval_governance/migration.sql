-- STEP 19 — Maker-Checker, Multi-Level Approval & High-Risk Action Governance.
-- Purely additive: 7 new enums, 9 new tables, and enum-value additions to
-- AdminTaskType/AssignmentResourceType/AuditAction/DataCategory/NotificationType.
-- No existing table, column, or enum value is altered or removed.

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PENDING_REVIEW', 'PENDING_APPROVAL', 'PARTIALLY_APPROVED', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'EXPIRED', 'CANCELLED', 'EXECUTION_PENDING', 'EXECUTING', 'EXECUTED', 'EXECUTION_FAILED', 'REOPENED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ApprovalRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ApprovalLevel" AS ENUM ('LEVEL_0', 'LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5');

-- CreateEnum
CREATE TYPE "ApprovalReviewerDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'RECUSED');

-- CreateEnum
CREATE TYPE "ApprovalStepStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SATISFIED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ApprovalExecutionStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ApprovalConflictType" AS ENUM ('SELF_APPROVAL', 'ASSIGNED_STAFF_CONFLICT', 'FINANCIAL_REQUESTER_CONFLICT', 'VERIFICATION_MAKER_CONFLICT', 'ROLE_POLICY_CONFLICT', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalDelegationStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminTaskType" ADD VALUE 'APPROVAL_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'HIGH_RISK_APPROVAL';
ALTER TYPE "AdminTaskType" ADD VALUE 'CRITICAL_APPROVAL';
ALTER TYPE "AdminTaskType" ADD VALUE 'FINANCE_APPROVAL';
ALTER TYPE "AdminTaskType" ADD VALUE 'CONTACT_APPROVAL';
ALTER TYPE "AdminTaskType" ADD VALUE 'VERIFICATION_APPROVAL';
ALTER TYPE "AdminTaskType" ADD VALUE 'PRIVACY_APPROVAL';
ALTER TYPE "AdminTaskType" ADD VALUE 'SECURITY_APPROVAL';
ALTER TYPE "AdminTaskType" ADD VALUE 'AI_APPROVAL';

-- AlterEnum
ALTER TYPE "AssignmentResourceType" ADD VALUE 'ADMIN_USER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'APPROVAL_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVAL_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVAL_VIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVAL_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVAL_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVAL_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVAL_CHANGES_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVAL_DELEGATED';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVAL_ESCALATED';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVAL_EXPIRED';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVAL_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVAL_EXECUTION_STARTED';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVAL_EXECUTED';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVAL_EXECUTION_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVAL_OVERRIDE_USED';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVAL_CONFLICT_BLOCKED';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVAL_POLICY_UPDATED';

-- AlterEnum
ALTER TYPE "DataCategory" ADD VALUE 'GOVERNANCE_APPROVAL_DATA';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'APPROVAL_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'APPROVAL_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'APPROVAL_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'APPROVAL_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'APPROVAL_CHANGES_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'APPROVAL_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE 'APPROVAL_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE 'APPROVAL_EXECUTION_STARTED';
ALTER TYPE "NotificationType" ADD VALUE 'APPROVAL_EXECUTED';
ALTER TYPE "NotificationType" ADD VALUE 'APPROVAL_EXECUTION_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'EMERGENCY_OVERRIDE_USED';

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "approvalCode" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "sourceType" "AssignmentResourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "makerId" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "riskLevel" "ApprovalRiskLevel" NOT NULL,
    "priority" "AssignmentPriority" NOT NULL DEFAULT 'NORMAL',
    "reason" TEXT NOT NULL,
    "currentStatePayload" JSONB,
    "requestedPayload" JSONB,
    "requiredLevel" "ApprovalLevel" NOT NULL,
    "currentLevel" "ApprovalLevel" NOT NULL DEFAULT 'LEVEL_0',
    "assignedCheckerId" TEXT,
    "assignedDepartmentId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdTaskId" TEXT,
    "executionStatus" "ApprovalExecutionStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "idempotencyKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "level" "ApprovalLevel" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "requiredRoles" "AdminRole"[],
    "requiredCount" INTEGER NOT NULL DEFAULT 1,
    "quorumCount" INTEGER NOT NULL DEFAULT 1,
    "status" "ApprovalStepStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalReviewer" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "roleAtDecision" "AdminRole",
    "decision" "ApprovalReviewerDecision" NOT NULL DEFAULT 'PENDING',
    "decisionReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalReviewer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalPolicy" (
    "id" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "riskLevel" "ApprovalRiskLevel" NOT NULL,
    "requiredLevel" "ApprovalLevel" NOT NULL,
    "minimumApprovers" INTEGER NOT NULL DEFAULT 1,
    "quorum" INTEGER NOT NULL DEFAULT 1,
    "allowedRoles" "AdminRole"[],
    "allowedDepartmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "makerCheckerRequired" BOOLEAN NOT NULL DEFAULT true,
    "reauthRequired" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorRequired" BOOLEAN NOT NULL DEFAULT false,
    "expirationMinutes" INTEGER NOT NULL DEFAULT 4320,
    "emergencyOverrideAllowed" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalAmountThreshold" (
    "id" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "minAmountMinor" INTEGER NOT NULL,
    "maxAmountMinor" INTEGER,
    "requiredLevel" "ApprovalLevel" NOT NULL,
    "minimumApprovers" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalAmountThreshold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDelegation" (
    "id" TEXT NOT NULL,
    "delegatorId" TEXT NOT NULL,
    "delegateId" TEXT NOT NULL,
    "allowedActionTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ApprovalDelegationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalDelegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalExecutionLog" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "executionStatus" "ApprovalExecutionStatus" NOT NULL,
    "executedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "ApprovalExecutionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalConflict" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "conflictType" "ApprovalConflictType" NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolution" TEXT,

    CONSTRAINT "ApprovalConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalEvent" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "actorId" TEXT,
    "eventType" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_approvalCode_key" ON "ApprovalRequest"("approvalCode");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_createdTaskId_key" ON "ApprovalRequest"("createdTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_idempotencyKey_key" ON "ApprovalRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_idx" ON "ApprovalRequest"("status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_actionType_idx" ON "ApprovalRequest"("actionType");

-- CreateIndex
CREATE INDEX "ApprovalRequest_sourceType_sourceId_idx" ON "ApprovalRequest"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_makerId_idx" ON "ApprovalRequest"("makerId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_expiresAt_idx" ON "ApprovalRequest"("expiresAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_assignedDepartmentId_idx" ON "ApprovalRequest"("assignedDepartmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalStep_approvalRequestId_sequence_key" ON "ApprovalStep"("approvalRequestId", "sequence");

-- CreateIndex
CREATE INDEX "ApprovalReviewer_approvalRequestId_idx" ON "ApprovalReviewer"("approvalRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalReviewer_stepId_reviewerId_key" ON "ApprovalReviewer"("stepId", "reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalPolicy_actionType_key" ON "ApprovalPolicy"("actionType");

-- CreateIndex
CREATE INDEX "ApprovalAmountThreshold_actionType_currencyCode_idx" ON "ApprovalAmountThreshold"("actionType", "currencyCode");

-- CreateIndex
CREATE INDEX "ApprovalDelegation_delegatorId_status_idx" ON "ApprovalDelegation"("delegatorId", "status");

-- CreateIndex
CREATE INDEX "ApprovalDelegation_delegateId_status_idx" ON "ApprovalDelegation"("delegateId", "status");

-- CreateIndex
CREATE INDEX "ApprovalExecutionLog_approvalRequestId_idx" ON "ApprovalExecutionLog"("approvalRequestId");

-- CreateIndex
CREATE INDEX "ApprovalConflict_approvalRequestId_idx" ON "ApprovalConflict"("approvalRequestId");

-- CreateIndex
CREATE INDEX "ApprovalEvent_approvalRequestId_createdAt_idx" ON "ApprovalEvent"("approvalRequestId", "createdAt");

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_assignedCheckerId_fkey" FOREIGN KEY ("assignedCheckerId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_assignedDepartmentId_fkey" FOREIGN KEY ("assignedDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_createdTaskId_fkey" FOREIGN KEY ("createdTaskId") REFERENCES "AdminTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalReviewer" ADD CONSTRAINT "ApprovalReviewer_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalReviewer" ADD CONSTRAINT "ApprovalReviewer_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "ApprovalStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalReviewer" ADD CONSTRAINT "ApprovalReviewer_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_delegatorId_fkey" FOREIGN KEY ("delegatorId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_delegateId_fkey" FOREIGN KEY ("delegateId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalExecutionLog" ADD CONSTRAINT "ApprovalExecutionLog_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalExecutionLog" ADD CONSTRAINT "ApprovalExecutionLog_executedById_fkey" FOREIGN KEY ("executedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalConflict" ADD CONSTRAINT "ApprovalConflict_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalConflict" ADD CONSTRAINT "ApprovalConflict_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalEvent" ADD CONSTRAINT "ApprovalEvent_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalEvent" ADD CONSTRAINT "ApprovalEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

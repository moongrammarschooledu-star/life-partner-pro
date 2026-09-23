-- CreateEnum
CREATE TYPE "TaskEscalationStatus" AS ENUM ('NONE', 'ESCALATED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "TaskVisibility" AS ENUM ('STANDARD', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "TaskCommentVisibility" AS ENUM ('INTERNAL', 'TEAM', 'MANAGER_ONLY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TaskDependencyType" AS ENUM ('BLOCKS', 'DEPENDS_ON');

-- CreateEnum
CREATE TYPE "WorkflowFailureStage" AS ENUM ('EVENT_RECEIVED', 'TASK_CREATION', 'ASSIGNMENT', 'NOTIFICATION', 'TRANSITION');

-- CreateEnum
CREATE TYPE "WorkflowEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminTaskStatus" ADD VALUE 'NEW';
ALTER TYPE "AdminTaskStatus" ADD VALUE 'ASSIGNED';
ALTER TYPE "AdminTaskStatus" ADD VALUE 'ACCEPTED';
ALTER TYPE "AdminTaskStatus" ADD VALUE 'WAITING_FOR_USER';
ALTER TYPE "AdminTaskStatus" ADD VALUE 'WAITING_FOR_STAFF';
ALTER TYPE "AdminTaskStatus" ADD VALUE 'WAITING_FOR_APPROVAL';
ALTER TYPE "AdminTaskStatus" ADD VALUE 'BLOCKED';
ALTER TYPE "AdminTaskStatus" ADD VALUE 'ESCALATED';
ALTER TYPE "AdminTaskStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "AdminTaskStatus" ADD VALUE 'REOPENED';
ALTER TYPE "AdminTaskStatus" ADD VALUE 'ARCHIVED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminTaskType" ADD VALUE 'PROFILE_UPDATE_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'VERIFICATION_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'VERIFICATION_REVERIFICATION';
ALTER TYPE "AdminTaskType" ADD VALUE 'MATCH_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'PROPOSAL_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'PROPOSAL_DECISION_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'CONTACT_PERMISSION_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'MEETING_REQUEST_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'MEETING_FOLLOWUP';
ALTER TYPE "AdminTaskType" ADD VALUE 'COMMUNICATION_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'SUPPORT_CASE_TASK';
ALTER TYPE "AdminTaskType" ADD VALUE 'SAFETY_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'PAYMENT_ISSUE_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'REFUND_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'RECONCILIATION_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'PRIVACY_REQUEST_TASK';
ALTER TYPE "AdminTaskType" ADD VALUE 'DELETION_REQUEST_TASK';
ALTER TYPE "AdminTaskType" ADD VALUE 'AI_SAFETY_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'GENERAL_ADMIN_TASK';

-- AlterEnum
ALTER TYPE "AssignmentPriority" ADD VALUE 'CRITICAL';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AssignmentResourceType" ADD VALUE 'PAYMENT';
ALTER TYPE "AssignmentResourceType" ADD VALUE 'PRIVACY_REQUEST';
ALTER TYPE "AssignmentResourceType" ADD VALUE 'AI_SAFETY_EVENT';
ALTER TYPE "AssignmentResourceType" ADD VALUE 'ADMIN_TASK';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'TASK_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_ACCEPTED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_STARTED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_PRIORITY_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_DUE_DATE_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_COMMENT_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_ESCALATED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_REOPENED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_ARCHIVED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_DEPENDENCY_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_CHECKLIST_ITEM_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_ATTACHMENT_UPLOADED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_TEMPLATE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_TEMPLATE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'TASK_SLA_CONFIG_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'WORKFLOW_RULE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'WORKFLOW_RULE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'WORKFLOW_FAILURE_RETRIED';
ALTER TYPE "AuditAction" ADD VALUE 'WORKFLOW_FAILURE_RESOLVED';
ALTER TYPE "AuditAction" ADD VALUE 'STAFF_AVAILABILITY_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'STAFF_AVAILABILITY_UPDATED';

-- AlterEnum
ALTER TYPE "DataCategory" ADD VALUE 'WORKFLOW_TASK_DATA';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'TASK_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_REASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_DUE_SOON';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_OVERDUE';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_ESCALATED';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_COMMENT_MENTION';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_DEPENDENCY_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_REOPENED';

-- AlterTable
ALTER TABLE "AdminTask" ADD COLUMN     "accessLevel" "AccessLevel" NOT NULL DEFAULT 'MANAGE',
ADD COLUMN     "assignedDepartmentId" TEXT,
ADD COLUMN     "completionNotes" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "escalationLevel" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "escalationStatus" "TaskEscalationStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "parentTaskId" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "taskCode" TEXT,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "visibility" "TaskVisibility" NOT NULL DEFAULT 'STANDARD';

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "TaskCommentVisibility" NOT NULL DEFAULT 'INTERNAL',
    "mentionedAdminIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskChecklistItem" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,

    CONSTRAINT "TaskChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,
    "type" "TaskDependencyType" NOT NULL DEFAULT 'DEPENDS_ON',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskEscalation" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "previousLevel" INTEGER NOT NULL,
    "newLevel" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "escalatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskStatusHistory" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "previousStatus" "AdminTaskStatus" NOT NULL,
    "newStatus" "AdminTaskStatus" NOT NULL,
    "changedById" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAttachment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "ivBase64" TEXT NOT NULL,
    "authTagBase64" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAccessLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "denyReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taskType" "AdminTaskType" NOT NULL,
    "titleTemplate" TEXT NOT NULL,
    "descriptionTemplate" TEXT,
    "defaultPriority" "AssignmentPriority" NOT NULL DEFAULT 'NORMAL',
    "defaultChecklist" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskSlaConfig" (
    "id" TEXT NOT NULL,
    "taskType" "AdminTaskType" NOT NULL,
    "targetResponseHours" INTEGER,
    "targetResolutionHours" INTEGER,
    "warningThresholdHours" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TaskSlaConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRule" (
    "id" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "taskType" "AdminTaskType" NOT NULL,
    "defaultPriority" "AssignmentPriority" NOT NULL DEFAULT 'NORMAL',
    "defaultAssignedRole" "AdminRole",
    "defaultAssignedDepartmentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowEvent" (
    "id" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "sourceType" "AssignmentResourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "payload" JSONB,
    "status" "WorkflowEventStatus" NOT NULL DEFAULT 'PENDING',
    "taskId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowFailure" (
    "id" TEXT NOT NULL,
    "workflowEventId" TEXT,
    "taskId" TEXT,
    "stage" "WorkflowFailureStage" NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" TEXT,
    "resolutionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowFailure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAvailability" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "backupAdminId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskComment_taskId_idx" ON "TaskComment"("taskId");

-- CreateIndex
CREATE INDEX "TaskChecklistItem_taskId_idx" ON "TaskChecklistItem"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDependency_taskId_dependsOnTaskId_key" ON "TaskDependency"("taskId", "dependsOnTaskId");

-- CreateIndex
CREATE INDEX "TaskEscalation_taskId_idx" ON "TaskEscalation"("taskId");

-- CreateIndex
CREATE INDEX "TaskStatusHistory_taskId_idx" ON "TaskStatusHistory"("taskId");

-- CreateIndex
CREATE INDEX "TaskAttachment_taskId_idx" ON "TaskAttachment"("taskId");

-- CreateIndex
CREATE INDEX "TaskAccessLog_taskId_idx" ON "TaskAccessLog"("taskId");

-- CreateIndex
CREATE INDEX "TaskAccessLog_adminId_idx" ON "TaskAccessLog"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskSlaConfig_taskType_key" ON "TaskSlaConfig"("taskType");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRule_eventName_key" ON "WorkflowRule"("eventName");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowEvent_dedupKey_key" ON "WorkflowEvent"("dedupKey");

-- CreateIndex
CREATE INDEX "WorkflowEvent_status_idx" ON "WorkflowEvent"("status");

-- CreateIndex
CREATE INDEX "WorkflowEvent_sourceType_sourceId_idx" ON "WorkflowEvent"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "WorkflowFailure_resolvedAt_idx" ON "WorkflowFailure"("resolvedAt");

-- CreateIndex
CREATE INDEX "StaffAvailability_adminId_active_idx" ON "StaffAvailability"("adminId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "AdminTask_taskCode_key" ON "AdminTask"("taskCode");

-- CreateIndex
CREATE INDEX "AdminTask_escalationLevel_escalationStatus_idx" ON "AdminTask"("escalationLevel", "escalationStatus");

-- CreateIndex
CREATE INDEX "AdminTask_parentTaskId_idx" ON "AdminTask"("parentTaskId");

-- CreateIndex
CREATE INDEX "AdminTask_assignedDepartmentId_idx" ON "AdminTask"("assignedDepartmentId");

-- AddForeignKey
ALTER TABLE "AdminTask" ADD CONSTRAINT "AdminTask_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "AdminTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminTask" ADD CONSTRAINT "AdminTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminTask" ADD CONSTRAINT "AdminTask_assignedDepartmentId_fkey" FOREIGN KEY ("assignedDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AdminTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskChecklistItem" ADD CONSTRAINT "TaskChecklistItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AdminTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskChecklistItem" ADD CONSTRAINT "TaskChecklistItem_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AdminTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "AdminTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEscalation" ADD CONSTRAINT "TaskEscalation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AdminTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEscalation" ADD CONSTRAINT "TaskEscalation_escalatedById_fkey" FOREIGN KEY ("escalatedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskStatusHistory" ADD CONSTRAINT "TaskStatusHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AdminTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskStatusHistory" ADD CONSTRAINT "TaskStatusHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AdminTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAccessLog" ADD CONSTRAINT "TaskAccessLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AdminTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAccessLog" ADD CONSTRAINT "TaskAccessLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplate" ADD CONSTRAINT "TaskTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEvent" ADD CONSTRAINT "WorkflowEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AdminTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowFailure" ADD CONSTRAINT "WorkflowFailure_workflowEventId_fkey" FOREIGN KEY ("workflowEventId") REFERENCES "WorkflowEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowFailure" ADD CONSTRAINT "WorkflowFailure_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AdminTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowFailure" ADD CONSTRAINT "WorkflowFailure_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAvailability" ADD CONSTRAINT "StaffAvailability_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAvailability" ADD CONSTRAINT "StaffAvailability_backupAdminId_fkey" FOREIGN KEY ("backupAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAvailability" ADD CONSTRAINT "StaffAvailability_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


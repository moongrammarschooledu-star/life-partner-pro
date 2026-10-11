-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'SOC_ALERT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'SOC_ALERT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'SOC_ALERT_ESCALATED';
ALTER TYPE "AuditAction" ADD VALUE 'SOC_RULE_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'SOC_RULE_DRY_RUN';
ALTER TYPE "AuditAction" ADD VALUE 'SOC_DETECTION_RUN';
ALTER TYPE "AuditAction" ADD VALUE 'SOC_INCIDENT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'SOC_INCIDENT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'SOC_CONTAINMENT_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'SOC_CONTAINMENT_DECIDED';
ALTER TYPE "AuditAction" ADD VALUE 'SOC_CONTAINMENT_EXECUTED';
ALTER TYPE "AuditAction" ADD VALUE 'SOC_CONFIG_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'SOC_RESTORE_DRILL_RECORDED';
ALTER TYPE "AuditAction" ADD VALUE 'SOC_RESTORE_DRILL_REVIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'SOC_DR_PLAN_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'SOC_DR_TEST_RECORDED';
ALTER TYPE "AuditAction" ADD VALUE 'SOC_ACCESS_DENIED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SOC_ALERT';
ALTER TYPE "NotificationType" ADD VALUE 'SOC_INCIDENT';

-- AlterEnum
ALTER TYPE "DataCategory" ADD VALUE 'SOC_ACCESS_DATA';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_PRIVILEGE_CHANGE';
ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_SESSION_ANOMALY';
ALTER TYPE "SecurityEventType" ADD VALUE 'BREAK_GLASS_USED';
ALTER TYPE "SecurityEventType" ADD VALUE 'WEBHOOK_SIGNATURE_FAILURE';
ALTER TYPE "SecurityEventType" ADD VALUE 'WEBHOOK_REPLAY_ATTEMPT';
ALTER TYPE "SecurityEventType" ADD VALUE 'RATE_LIMIT_EXCEEDED';
ALTER TYPE "SecurityEventType" ADD VALUE 'BULK_EXPORT';
ALTER TYPE "SecurityEventType" ADD VALUE 'SENSITIVE_RECORD_ACCESS';
ALTER TYPE "SecurityEventType" ADD VALUE 'PROFILE_SEARCH';
ALTER TYPE "SecurityEventType" ADD VALUE 'BACKUP_FAILED';
ALTER TYPE "SecurityEventType" ADD VALUE 'BACKUP_DELETION_ATTEMPT';
ALTER TYPE "SecurityEventType" ADD VALUE 'AI_PROMPT_INJECTION_SUSPECTED';
ALTER TYPE "SecurityEventType" ADD VALUE 'AI_UNAUTHORIZED_ACTION_ATTEMPT';
ALTER TYPE "SecurityEventType" ADD VALUE 'SECURITY_CONFIG_CHANGED';

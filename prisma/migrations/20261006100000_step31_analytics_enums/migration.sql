-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_METRIC_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_METRIC_REVIEWED';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_KPI_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_DASHBOARD_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_DASHBOARD_SHARED';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_REPORT_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_REPORT_RUN';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_REPORT_EXPORTED';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_REPORT_SCHEDULED';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_REPORT_DELIVERED';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_SENSITIVE_ACCESS';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_PIPELINE_RUN';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_REBUILD';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_SETTINGS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_DATA_QUALITY_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_RECONCILIATION_RUN';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_ALERT_RULE_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_ALERT_TRIGGERED';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_FORECAST_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_AI_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE 'ANALYTICS_ACCESS_DENIED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'ANALYTICS_ALERT';
ALTER TYPE "NotificationType" ADD VALUE 'ANALYTICS_REPORT_READY';

-- AlterEnum
ALTER TYPE "DataCategory" ADD VALUE 'ANALYTICS_ACCESS_DATA';

-- AlterEnum
ALTER TYPE "AiFeature" ADD VALUE 'ANALYTICS_ASSISTANT';


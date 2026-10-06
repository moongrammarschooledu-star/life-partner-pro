-- CreateEnum
CREATE TYPE "AnalyticsMetricStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "AnalyticsRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "AnalyticsIssueStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'IGNORED_WITH_REASON');

-- CreateEnum
CREATE TYPE "AnalyticsSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AnalyticsShareScope" AS ENUM ('PRIVATE', 'TEAM', 'DEPARTMENT', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "AnalyticsObjectStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AnalyticsReconStatus" AS ENUM ('RECONCILED', 'VARIANCE', 'ERROR');

-- CreateEnum
CREATE TYPE "AnalyticsAlertEventStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "AnalyticsKpiFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateTable
CREATE TABLE "AnalyticsSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "timezone" VARCHAR(40) NOT NULL DEFAULT 'Asia/Karachi',
    "minGroupSize" INTEGER NOT NULL DEFAULT 5,
    "activeEvents" JSONB NOT NULL,
    "freshnessSlaHours" INTEGER NOT NULL DEFAULT 30,
    "tenantId" VARCHAR(40) NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsMetricDefinition" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "code" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(600) NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "ownerAdminId" TEXT,
    "ownerLabel" VARCHAR(80),
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "status" "AnalyticsMetricStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "tenantId" VARCHAR(40) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsMetricDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsMetricVersion" (
    "id" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AnalyticsMetricStatus" NOT NULL DEFAULT 'DRAFT',
    "formula" VARCHAR(600) NOT NULL,
    "source" VARCHAR(200) NOT NULL,
    "filters" JSONB,
    "exclusions" JSONB,
    "computeVersion" VARCHAR(10) NOT NULL,
    "changeSummary" VARCHAR(300),
    "authorId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "effectiveFrom" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsMetricVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsDailyMetric" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "metricKey" VARCHAR(80) NOT NULL,
    "metricVersion" INTEGER NOT NULL DEFAULT 1,
    "dimensionKey" VARCHAR(40) NOT NULL DEFAULT 'ALL',
    "dimensionValue" VARCHAR(120) NOT NULL DEFAULT 'ALL',
    "currencyCode" VARCHAR(3) NOT NULL DEFAULT '',
    "value" BIGINT NOT NULL DEFAULT 0,
    "denominator" BIGINT,
    "tenantId" VARCHAR(40) NOT NULL DEFAULT '',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsDailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsMart" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(300),
    "metricKeys" JSONB NOT NULL,
    "status" "AnalyticsRunStatus" NOT NULL DEFAULT 'SUCCEEDED',
    "lastRefreshedAt" TIMESTAMP(3),
    "lastCoveredDate" DATE,
    "lastError" VARCHAR(300),
    "tenantId" VARCHAR(40) NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsMart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsRefreshRun" (
    "id" TEXT NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "martKey" VARCHAR(40),
    "metricKey" VARCHAR(80),
    "rangeFrom" DATE NOT NULL,
    "rangeTo" DATE NOT NULL,
    "cursorDate" DATE,
    "status" "AnalyticsRunStatus" NOT NULL DEFAULT 'RUNNING',
    "metricsComputed" INTEGER NOT NULL DEFAULT 0,
    "rowsWritten" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(300),
    "triggeredBy" VARCHAR(40),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AnalyticsRefreshRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsKpi" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(600) NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "ownerAdminId" TEXT,
    "visibility" VARCHAR(60),
    "status" "AnalyticsMetricStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "tenantId" VARCHAR(40) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsKpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsKpiVersion" (
    "id" TEXT NOT NULL,
    "kpiId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "formula" JSONB NOT NULL,
    "formulaText" VARCHAR(300) NOT NULL,
    "direction" VARCHAR(16) NOT NULL DEFAULT 'HIGHER_BETTER',
    "frequency" "AnalyticsKpiFrequency" NOT NULL DEFAULT 'MONTHLY',
    "changeSummary" VARCHAR(300),
    "authorId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsKpiVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsKpiTarget" (
    "id" TEXT NOT NULL,
    "kpiId" TEXT NOT NULL,
    "frequency" "AnalyticsKpiFrequency" NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "warningThreshold" DOUBLE PRECISION,
    "criticalThreshold" DOUBLE PRECISION,
    "setById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsKpiTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsDashboard" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(300),
    "ownerId" TEXT NOT NULL,
    "widgets" JSONB NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "AnalyticsObjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "tenantId" VARCHAR(40) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsDashboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsDashboardVersion" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "widgets" JSONB NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsDashboardVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsDashboardShare" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "scope" "AnalyticsShareScope" NOT NULL,
    "scopeValue" VARCHAR(60) NOT NULL DEFAULT '',
    "sharedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsDashboardShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsReport" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(300),
    "ownerId" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "AnalyticsObjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "visibility" "AnalyticsShareScope" NOT NULL DEFAULT 'PRIVATE',
    "visibilityValue" VARCHAR(60) NOT NULL DEFAULT '',
    "tenantId" VARCHAR(40) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsReportVersion" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsReportVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsReportSchedule" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "frequency" "ReportFrequency" NOT NULL,
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "hourLocal" INTEGER NOT NULL DEFAULT 8,
    "recipientAdminIds" JSONB NOT NULL,
    "status" "AnalyticsObjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "pausedReason" VARCHAR(200),
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsReportDelivery" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "outcome" VARCHAR(24) NOT NULL,
    "reason" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsReportDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsDataQualityIssue" (
    "id" TEXT NOT NULL,
    "checkKey" VARCHAR(60) NOT NULL,
    "subjectRef" VARCHAR(80) NOT NULL,
    "subjectType" VARCHAR(40) NOT NULL,
    "severity" "AnalyticsSeverity" NOT NULL DEFAULT 'WARNING',
    "detail" JSONB,
    "status" "AnalyticsIssueStatus" NOT NULL DEFAULT 'OPEN',
    "ignoreReason" VARCHAR(300),
    "assignedToId" TEXT,
    "handledById" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "tenantId" VARCHAR(40) NOT NULL DEFAULT '',

    CONSTRAINT "AnalyticsDataQualityIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsReconciliationRun" (
    "id" TEXT NOT NULL,
    "status" "AnalyticsRunStatus" NOT NULL DEFAULT 'RUNNING',
    "rangeFrom" DATE NOT NULL,
    "rangeTo" DATE NOT NULL,
    "triggeredBy" VARCHAR(40),
    "summary" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AnalyticsReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsReconciliationItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "domain" VARCHAR(30) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "operationalValue" BIGINT NOT NULL,
    "analyticsValue" BIGINT NOT NULL,
    "variance" BIGINT NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL DEFAULT '',
    "status" "AnalyticsReconStatus" NOT NULL,
    "note" VARCHAR(200),

    CONSTRAINT "AnalyticsReconciliationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsAlertRule" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "metricKey" VARCHAR(80) NOT NULL,
    "operator" VARCHAR(4) NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "windowHours" INTEGER NOT NULL DEFAULT 24,
    "minSample" INTEGER NOT NULL DEFAULT 20,
    "severity" "AnalyticsSeverity" NOT NULL DEFAULT 'WARNING',
    "recipientAdminIds" JSONB NOT NULL,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 720,
    "status" "AnalyticsObjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "lastEvaluatedAt" TIMESTAMP(3),
    "lastTriggeredAt" TIMESTAMP(3),
    "tenantId" VARCHAR(40) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsAlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsAlertEvent" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "observedValue" DOUBLE PRECISION NOT NULL,
    "sample" INTEGER NOT NULL,
    "severity" "AnalyticsSeverity" NOT NULL,
    "status" "AnalyticsAlertEventStatus" NOT NULL DEFAULT 'OPEN',
    "message" VARCHAR(300) NOT NULL,
    "notified" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "AnalyticsAlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsForecast" (
    "id" TEXT NOT NULL,
    "metricKey" VARCHAR(80) NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL DEFAULT '',
    "model" VARCHAR(40) NOT NULL,
    "historyFrom" DATE NOT NULL,
    "historyTo" DATE NOT NULL,
    "horizonDays" INTEGER NOT NULL,
    "points" JSONB NOT NULL,
    "assumptions" JSONB NOT NULL,
    "limitations" JSONB NOT NULL,
    "generatedById" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsForecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsAccessLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" VARCHAR(16) NOT NULL,
    "resource" VARCHAR(60) NOT NULL,
    "resourceId" VARCHAR(60),
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "outcome" VARCHAR(10) NOT NULL DEFAULT 'ALLOWED',
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsMetricDefinition_key_key" ON "AnalyticsMetricDefinition"("key");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsMetricDefinition_code_key" ON "AnalyticsMetricDefinition"("code");

-- CreateIndex
CREATE INDEX "AnalyticsMetricDefinition_category_status_idx" ON "AnalyticsMetricDefinition"("category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsMetricVersion_metricId_version_key" ON "AnalyticsMetricVersion"("metricId", "version");

-- CreateIndex
CREATE INDEX "AnalyticsDailyMetric_metricKey_date_idx" ON "AnalyticsDailyMetric"("metricKey", "date");

-- CreateIndex
CREATE INDEX "AnalyticsDailyMetric_date_idx" ON "AnalyticsDailyMetric"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDailyMetric_date_metricKey_metricVersion_dimension_key" ON "AnalyticsDailyMetric"("date", "metricKey", "metricVersion", "dimensionKey", "dimensionValue", "currencyCode", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsMart_key_key" ON "AnalyticsMart"("key");

-- CreateIndex
CREATE INDEX "AnalyticsRefreshRun_status_startedAt_idx" ON "AnalyticsRefreshRun"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsKpi_code_key" ON "AnalyticsKpi"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsKpi_key_key" ON "AnalyticsKpi"("key");

-- CreateIndex
CREATE INDEX "AnalyticsKpi_category_status_idx" ON "AnalyticsKpi"("category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsKpiVersion_kpiId_version_key" ON "AnalyticsKpiVersion"("kpiId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsKpiTarget_kpiId_frequency_key" ON "AnalyticsKpiTarget"("kpiId", "frequency");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDashboard_code_key" ON "AnalyticsDashboard"("code");

-- CreateIndex
CREATE INDEX "AnalyticsDashboard_ownerId_status_idx" ON "AnalyticsDashboard"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDashboardVersion_dashboardId_version_key" ON "AnalyticsDashboardVersion"("dashboardId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDashboardShare_dashboardId_scope_scopeValue_key" ON "AnalyticsDashboardShare"("dashboardId", "scope", "scopeValue");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsReport_code_key" ON "AnalyticsReport"("code");

-- CreateIndex
CREATE INDEX "AnalyticsReport_ownerId_status_idx" ON "AnalyticsReport"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsReportVersion_reportId_version_key" ON "AnalyticsReportVersion"("reportId", "version");

-- CreateIndex
CREATE INDEX "AnalyticsReportSchedule_status_nextRunAt_idx" ON "AnalyticsReportSchedule"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "AnalyticsReportDelivery_scheduleId_createdAt_idx" ON "AnalyticsReportDelivery"("scheduleId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsDataQualityIssue_status_severity_idx" ON "AnalyticsDataQualityIssue"("status", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDataQualityIssue_checkKey_subjectRef_key" ON "AnalyticsDataQualityIssue"("checkKey", "subjectRef");

-- CreateIndex
CREATE INDEX "AnalyticsReconciliationRun_startedAt_idx" ON "AnalyticsReconciliationRun"("startedAt");

-- CreateIndex
CREATE INDEX "AnalyticsReconciliationItem_runId_idx" ON "AnalyticsReconciliationItem"("runId");

-- CreateIndex
CREATE INDEX "AnalyticsAlertRule_status_metricKey_idx" ON "AnalyticsAlertRule"("status", "metricKey");

-- CreateIndex
CREATE INDEX "AnalyticsAlertEvent_ruleId_createdAt_idx" ON "AnalyticsAlertEvent"("ruleId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsAlertEvent_status_createdAt_idx" ON "AnalyticsAlertEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsForecast_metricKey_generatedAt_idx" ON "AnalyticsForecast"("metricKey", "generatedAt");

-- CreateIndex
CREATE INDEX "AnalyticsAccessLog_adminId_createdAt_idx" ON "AnalyticsAccessLog"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsAccessLog_sensitive_createdAt_idx" ON "AnalyticsAccessLog"("sensitive", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsAccessLog_createdAt_idx" ON "AnalyticsAccessLog"("createdAt");

-- AddForeignKey
ALTER TABLE "AnalyticsMetricVersion" ADD CONSTRAINT "AnalyticsMetricVersion_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "AnalyticsMetricDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsKpiVersion" ADD CONSTRAINT "AnalyticsKpiVersion_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "AnalyticsKpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsKpiTarget" ADD CONSTRAINT "AnalyticsKpiTarget_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "AnalyticsKpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsDashboardVersion" ADD CONSTRAINT "AnalyticsDashboardVersion_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "AnalyticsDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsDashboardShare" ADD CONSTRAINT "AnalyticsDashboardShare_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "AnalyticsDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsReportVersion" ADD CONSTRAINT "AnalyticsReportVersion_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AnalyticsReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsReportSchedule" ADD CONSTRAINT "AnalyticsReportSchedule_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AnalyticsReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsReportDelivery" ADD CONSTRAINT "AnalyticsReportDelivery_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "AnalyticsReportSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsReconciliationItem" ADD CONSTRAINT "AnalyticsReconciliationItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalyticsReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsAlertEvent" ADD CONSTRAINT "AnalyticsAlertEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AnalyticsAlertRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;


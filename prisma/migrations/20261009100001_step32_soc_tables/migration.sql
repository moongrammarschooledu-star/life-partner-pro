-- CreateEnum
CREATE TYPE "SocSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SocAlertStatus" AS ENUM ('NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE', 'ESCALATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SocIncidentStatus" AS ENUM ('DETECTED', 'TRIAGED', 'INVESTIGATING', 'CONTAINMENT', 'REMEDIATION', 'RECOVERY', 'POST_INCIDENT_REVIEW', 'CLOSED');

-- CreateEnum
CREATE TYPE "SocIncidentCategory" AS ENUM ('ACCOUNT_COMPROMISE', 'AUTHENTICATION_ATTACK', 'AUTHORIZATION_FAILURE', 'DATA_EXPOSURE', 'PRIVACY_INCIDENT', 'MALICIOUS_ATTACHMENT', 'API_ATTACK', 'WEBHOOK_COMPROMISE', 'PAYMENT_SECURITY', 'AI_SECURITY', 'DOCUMENT_ACCESS', 'BACKUP_RECOVERY_FAILURE', 'THIRD_PARTY_PROVIDER');

-- CreateEnum
CREATE TYPE "SocRuleVersionStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SocContainmentStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED');

-- CreateEnum
CREATE TYPE "SocDrillStatus" AS ENUM ('IN_PROGRESS', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "SocPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "SocSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "suppressionWindowMinutes" INTEGER NOT NULL DEFAULT 240,
    "escalateCriticalMinutes" INTEGER NOT NULL DEFAULT 15,
    "escalateHighMinutes" INTEGER NOT NULL DEFAULT 60,
    "escalateMediumMinutes" INTEGER NOT NULL DEFAULT 480,
    "sessionIdleMinutes" INTEGER,
    "maxConcurrentSessions" INTEGER,
    "stepUpForHighRisk" BOOLEAN NOT NULL DEFAULT true,
    "enforceMfaPrivileged" BOOLEAN NOT NULL DEFAULT false,
    "accessLogRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "alertRetentionDays" INTEGER NOT NULL DEFAULT 730,
    "lastDetectionAt" TIMESTAMP(3),
    "lastDetectionSummary" JSONB,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocConfigVersion" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "changes" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocConfigVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocDetectionRule" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocDetectionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocRuleVersion" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "SocRuleVersionStatus" NOT NULL DEFAULT 'ACTIVE',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "severity" "SocSeverity" NOT NULL,
    "threshold" INTEGER NOT NULL,
    "windowMinutes" INTEGER NOT NULL,
    "params" JSONB,
    "changeReason" TEXT NOT NULL,
    "authorId" TEXT,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocAlert" (
    "id" TEXT NOT NULL,
    "alertCode" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "ruleVersion" INTEGER,
    "category" TEXT NOT NULL,
    "severity" "SocSeverity" NOT NULL,
    "status" "SocAlertStatus" NOT NULL DEFAULT 'NEW',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "affectedResource" TEXT,
    "evidenceRefs" JSONB,
    "dedupKey" TEXT NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedToId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "escalatedAt" TIMESTAMP(3),
    "incidentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocAlertEvent" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT,
    "fromStatus" "SocAlertStatus",
    "toStatus" "SocAlertStatus",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocAlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocIncident" (
    "id" TEXT NOT NULL,
    "incidentCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "SocIncidentCategory" NOT NULL,
    "severity" "SocSeverity" NOT NULL,
    "status" "SocIncidentStatus" NOT NULL DEFAULT 'DETECTED',
    "ownerId" TEXT,
    "summary" TEXT NOT NULL,
    "alertIds" JSONB,
    "evidenceRefs" JSONB,
    "communicationPlan" TEXT,
    "rootCause" TEXT,
    "lessonsLearned" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocIncidentEvent" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT,
    "fromStatus" "SocIncidentStatus",
    "toStatus" "SocIncidentStatus",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocIncidentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocContainmentAction" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "status" "SocContainmentStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "executedAt" TIMESTAMP(3),
    "result" TEXT,
    "technicalControlId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocContainmentAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocAccessLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" VARCHAR(16) NOT NULL,
    "resource" VARCHAR(60) NOT NULL,
    "resourceId" VARCHAR(60),
    "outcome" VARCHAR(10) NOT NULL DEFAULT 'ALLOWED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestoreDrill" (
    "id" TEXT NOT NULL,
    "backupId" TEXT,
    "backupCode" TEXT,
    "environmentLabel" TEXT NOT NULL,
    "status" "SocDrillStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "items" JSONB NOT NULL,
    "verifySummary" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "performedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "failureNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestoreDrill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisasterRecoveryPlan" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "SocPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "sections" JSONB NOT NULL,
    "testEveryDays" INTEGER,
    "changeReason" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisasterRecoveryPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisasterRecoveryTest" (
    "id" TEXT NOT NULL,
    "planVersion" INTEGER,
    "testType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "performedAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "findings" TEXT,
    "drillId" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisasterRecoveryTest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SocConfigVersion_version_key" ON "SocConfigVersion"("version");

-- CreateIndex
CREATE UNIQUE INDEX "SocDetectionRule_key_key" ON "SocDetectionRule"("key");

-- CreateIndex
CREATE INDEX "SocRuleVersion_status_idx" ON "SocRuleVersion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SocRuleVersion_ruleId_version_key" ON "SocRuleVersion"("ruleId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SocAlert_alertCode_key" ON "SocAlert"("alertCode");

-- CreateIndex
CREATE INDEX "SocAlert_status_severity_idx" ON "SocAlert"("status", "severity");

-- CreateIndex
CREATE INDEX "SocAlert_dedupKey_status_idx" ON "SocAlert"("dedupKey", "status");

-- CreateIndex
CREATE INDEX "SocAlert_ruleKey_createdAt_idx" ON "SocAlert"("ruleKey", "createdAt");

-- CreateIndex
CREATE INDEX "SocAlert_createdAt_idx" ON "SocAlert"("createdAt");

-- CreateIndex
CREATE INDEX "SocAlertEvent_alertId_createdAt_idx" ON "SocAlertEvent"("alertId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocIncident_incidentCode_key" ON "SocIncident"("incidentCode");

-- CreateIndex
CREATE INDEX "SocIncident_status_severity_idx" ON "SocIncident"("status", "severity");

-- CreateIndex
CREATE INDEX "SocIncident_createdAt_idx" ON "SocIncident"("createdAt");

-- CreateIndex
CREATE INDEX "SocIncidentEvent_incidentId_createdAt_idx" ON "SocIncidentEvent"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "SocContainmentAction_incidentId_idx" ON "SocContainmentAction"("incidentId");

-- CreateIndex
CREATE INDEX "SocContainmentAction_status_idx" ON "SocContainmentAction"("status");

-- CreateIndex
CREATE INDEX "SocAccessLog_adminId_createdAt_idx" ON "SocAccessLog"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "SocAccessLog_createdAt_idx" ON "SocAccessLog"("createdAt");

-- CreateIndex
CREATE INDEX "RestoreDrill_status_startedAt_idx" ON "RestoreDrill"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DisasterRecoveryPlan_version_key" ON "DisasterRecoveryPlan"("version");

-- CreateIndex
CREATE INDEX "DisasterRecoveryPlan_status_idx" ON "DisasterRecoveryPlan"("status");

-- CreateIndex
CREATE INDEX "DisasterRecoveryTest_status_performedAt_idx" ON "DisasterRecoveryTest"("status", "performedAt");

-- AddForeignKey
ALTER TABLE "SocRuleVersion" ADD CONSTRAINT "SocRuleVersion_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "SocDetectionRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocAlertEvent" ADD CONSTRAINT "SocAlertEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "SocAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocIncidentEvent" ADD CONSTRAINT "SocIncidentEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "SocIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocContainmentAction" ADD CONSTRAINT "SocContainmentAction_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "SocIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

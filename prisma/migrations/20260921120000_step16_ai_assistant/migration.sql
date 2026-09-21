-- CreateEnum
CREATE TYPE "AiProviderKind" AS ENUM ('RULES', 'ANTHROPIC', 'DISABLED');

-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('PROFILE_SUMMARY', 'MATCH_EXPLANATION', 'COMPARE', 'PROPOSAL_ASSISTANT', 'COMMUNICATION_ASSISTANT', 'FOLLOWUP_ASSISTANT', 'COPILOT', 'REPORT_ASSISTANT', 'DATA_QUALITY', 'PROFILE_IMPROVEMENT');

-- CreateEnum
CREATE TYPE "AiRequestStatus" AS ENUM ('SUCCESS', 'FAILED', 'BLOCKED_SAFETY', 'CONSENT_REQUIRED', 'DENIED', 'RATE_LIMITED', 'QUOTA_EXCEEDED', 'DISABLED', 'FALLBACK');

-- CreateEnum
CREATE TYPE "AiRolloutPhase" AS ENUM ('DISABLED', 'INTERNAL_TEST', 'STAFF_PILOT', 'LIMITED_PRODUCTION', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "AiStorageMode" AS ENUM ('DO_NOT_STORE', 'SUMMARY_ONLY', 'FULL_RESULT', 'LIMITED_PERIOD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'AI_PROFILE_SUMMARY_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_MATCH_EXPLANATION_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_COMPARISON_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_PROPOSAL_ASSISTANCE_USED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_MESSAGE_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_COPILOT_USED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_DATA_ACCESS_DENIED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_PROVIDER_ERROR';
ALTER TYPE "AuditAction" ADD VALUE 'AI_SAFETY_BLOCK';
ALTER TYPE "AuditAction" ADD VALUE 'AI_CONFIGURATION_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_KILL_SWITCH_USED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_ROLLOUT_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_REVIEW_SUGGESTED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_OUTPUT_SAFETY_BLOCKED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_FOLLOWUP_DRAFTED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_REPORT_SUMMARY_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_DATA_QUALITY_CHECKED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ConsentCategory" ADD VALUE 'AI_PROFILE_ASSISTANCE';
ALTER TYPE "ConsentCategory" ADD VALUE 'AI_COMMUNICATION_ASSISTANCE';

-- CreateTable
CREATE TABLE "AiConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "phase" "AiRolloutPhase" NOT NULL DEFAULT 'DISABLED',
    "killSwitchActive" BOOLEAN NOT NULL DEFAULT false,
    "killSwitchReason" TEXT,
    "killSwitchAt" TIMESTAMP(3),
    "provider" "AiProviderKind" NOT NULL DEFAULT 'RULES',
    "externalProviderAllowed" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT NOT NULL DEFAULT 'lpp-rules-v1',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "maxOutputTokens" INTEGER NOT NULL DEFAULT 1200,
    "timeoutMs" INTEGER NOT NULL DEFAULT 15000,
    "retryCount" INTEGER NOT NULL DEFAULT 1,
    "dailyRequestCap" INTEGER NOT NULL DEFAULT 500,
    "monthlyRequestCap" INTEGER NOT NULL DEFAULT 10000,
    "rateLimits" JSONB,
    "storageModes" JSONB,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "cacheTtlMinutes" INTEGER NOT NULL DEFAULT 60,
    "pilotAdminIds" TEXT[],
    "priceInputPerMTokUsd" DOUBLE PRECISION,
    "priceOutputPerMTokUsd" DOUBLE PRECISION,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPromptVersion" (
    "id" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "feature" "AiFeature" NOT NULL,
    "checksum" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "testRunId" TEXT,
    "activatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRequest" (
    "id" TEXT NOT NULL,
    "actorAdminId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "feature" "AiFeature" NOT NULL,
    "status" "AiRequestStatus" NOT NULL,
    "provider" "AiProviderKind" NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "aiVersion" TEXT NOT NULL,
    "appVersion" TEXT,
    "matchAlgorithmVersion" TEXT,
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCostUsd" DOUBLE PRECISION,
    "costIsEstimate" BOOLEAN NOT NULL DEFAULT false,
    "correlationId" TEXT,
    "consentOutcome" TEXT,
    "errorCode" TEXT,
    "fromCache" BOOLEAN NOT NULL DEFAULT false,
    "profileIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiResult" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "feature" "AiFeature" NOT NULL,
    "profileIds" TEXT[],
    "structured" JSONB,
    "storageMode" "AiStorageMode" NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "cacheKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSafetyEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "actorAdminId" TEXT,
    "feature" "AiFeature",
    "rule" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSafetyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConfigHistory" (
    "id" TEXT NOT NULL,
    "actorAdminId" TEXT,
    "kind" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiConfigHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTestRun" (
    "id" TEXT NOT NULL,
    "suite" TEXT NOT NULL,
    "testVersion" TEXT NOT NULL,
    "provider" "AiProviderKind" NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersions" JSONB,
    "passed" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "failures" JSONB,
    "triggeredById" TEXT,
    "commitSha" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiTestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiPromptVersion_feature_active_idx" ON "AiPromptVersion"("feature", "active");

-- CreateIndex
CREATE UNIQUE INDEX "AiPromptVersion_promptId_version_key" ON "AiPromptVersion"("promptId", "version");

-- CreateIndex
CREATE INDEX "AiRequest_createdAt_idx" ON "AiRequest"("createdAt");

-- CreateIndex
CREATE INDEX "AiRequest_actorAdminId_feature_createdAt_idx" ON "AiRequest"("actorAdminId", "feature", "createdAt");

-- CreateIndex
CREATE INDEX "AiRequest_status_createdAt_idx" ON "AiRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AiRequest_profileIds_idx" ON "AiRequest" USING GIN ("profileIds");

-- CreateIndex
CREATE UNIQUE INDEX "AiResult_requestId_key" ON "AiResult"("requestId");

-- CreateIndex
CREATE INDEX "AiResult_expiresAt_idx" ON "AiResult"("expiresAt");

-- CreateIndex
CREATE INDEX "AiResult_cacheKey_idx" ON "AiResult"("cacheKey");

-- CreateIndex
CREATE INDEX "AiResult_profileIds_idx" ON "AiResult" USING GIN ("profileIds");

-- CreateIndex
CREATE INDEX "AiSafetyEvent_createdAt_idx" ON "AiSafetyEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AiSafetyEvent_rule_createdAt_idx" ON "AiSafetyEvent"("rule", "createdAt");

-- CreateIndex
CREATE INDEX "AiConfigHistory_kind_createdAt_idx" ON "AiConfigHistory"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "AiTestRun_suite_createdAt_idx" ON "AiTestRun"("suite", "createdAt");

-- AddForeignKey
ALTER TABLE "AiResult" ADD CONSTRAINT "AiResult_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AiRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;


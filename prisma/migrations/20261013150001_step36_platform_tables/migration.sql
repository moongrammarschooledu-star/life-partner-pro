-- CreateEnum
CREATE TYPE "FeatureFlagState" AS ENUM ('DISABLED', 'ENABLED', 'ROLLOUT', 'PAUSED', 'EMERGENCY_DISABLED');

-- CreateEnum
CREATE TYPE "PlatformAnnouncementKind" AS ENUM ('MAINTENANCE', 'SECURITY_NOTICE', 'SERVICE_INTERRUPTION', 'PLATFORM_UPDATE');

-- CreateEnum
CREATE TYPE "PlatformAnnouncementStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RESOLVED', 'ENDED');

-- AlterTable
ALTER TABLE "SystemControl" ADD COLUMN     "readOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "FeatureFlag" ADD COLUMN     "reason" TEXT,
ADD COLUMN     "rolloutPercent" INTEGER,
ADD COLUMN     "state" "FeatureFlagState" NOT NULL DEFAULT 'ENABLED',
ADD COLUMN     "targets" JSONB,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "type" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PlatformConfigChange" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "actorId" TEXT,
    "sessionId" TEXT,
    "reason" TEXT,
    "approvalId" TEXT,
    "environment" TEXT NOT NULL,
    "rolledBackFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformConfigChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformProviderCheck" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "health" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "detail" VARCHAR(200),
    "checkedById" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformProviderCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformChangeFreeze" (
    "id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "endedById" TEXT,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformChangeFreeze_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformBreakGlassEvent" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "actionsCount" INTEGER NOT NULL DEFAULT 0,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,

    CONSTRAINT "PlatformBreakGlassEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAnnouncement" (
    "id" TEXT NOT NULL,
    "kind" "PlatformAnnouncementKind" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(1200) NOT NULL,
    "audience" TEXT[],
    "status" "PlatformAnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "showOnStatusPage" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformConfigChange_kind_key_version_key" ON "PlatformConfigChange"("kind", "key", "version");

-- CreateIndex
CREATE INDEX "PlatformConfigChange_createdAt_idx" ON "PlatformConfigChange"("createdAt");

-- CreateIndex
CREATE INDEX "PlatformConfigChange_actorId_createdAt_idx" ON "PlatformConfigChange"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformProviderCheck_providerKey_checkedAt_idx" ON "PlatformProviderCheck"("providerKey", "checkedAt");

-- CreateIndex
CREATE INDEX "PlatformChangeFreeze_endedAt_idx" ON "PlatformChangeFreeze"("endedAt");

-- CreateIndex
CREATE INDEX "PlatformBreakGlassEvent_adminId_grantedAt_idx" ON "PlatformBreakGlassEvent"("adminId", "grantedAt");

-- CreateIndex
CREATE INDEX "PlatformBreakGlassEvent_expiresAt_idx" ON "PlatformBreakGlassEvent"("expiresAt");

-- CreateIndex
CREATE INDEX "PlatformAnnouncement_status_startsAt_idx" ON "PlatformAnnouncement"("status", "startsAt");

-- Existing flags keep their meaning: a flag that was switched off is DISABLED, everything else stays ENABLED (the column default).
UPDATE "FeatureFlag" SET "state" = 'DISABLED' WHERE "enabled" = false;

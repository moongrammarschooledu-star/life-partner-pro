-- CreateEnum
CREATE TYPE "MobilePlatform" AS ENUM ('ANDROID', 'IOS');

-- CreateEnum
CREATE TYPE "MobileDeviceStatus" AS ENUM ('ACTIVE', 'REMOVED', 'TOKEN_INVALID');

-- CreateEnum
CREATE TYPE "MobileReleaseStatus" AS ENUM ('DRAFT', 'INTERNAL_TESTING', 'CLOSED_TESTING', 'OPEN_TESTING', 'PRODUCTION', 'PAUSED', 'RETIRED');

-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "pushDisplayMode" VARCHAR(10) NOT NULL DEFAULT 'PRIVATE';

-- CreateTable
CREATE TABLE "MobileDevice" (
    "id" TEXT NOT NULL,
    "installationId" VARCHAR(64) NOT NULL,
    "platform" "MobilePlatform" NOT NULL,
    "ownerKind" VARCHAR(10) NOT NULL,
    "profileId" TEXT,
    "familyMemberId" TEXT,
    "sessionId" TEXT,
    "appVersion" VARCHAR(32) NOT NULL,
    "osVersion" VARCHAR(32),
    "deviceLabel" VARCHAR(80),
    "pushProvider" VARCHAR(8),
    "pushTokenEnc" TEXT,
    "pushTokenHash" VARCHAR(64),
    "pushTokenAt" TIMESTAMP(3),
    "displayMode" VARCHAR(10),
    "biometricEnabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "MobileDeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "MobileDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobilePushDelivery" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "notificationId" TEXT,
    "notificationType" VARCHAR(60) NOT NULL,
    "status" VARCHAR(14) NOT NULL,
    "reason" VARCHAR(60),
    "providerMessageId" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobilePushDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileVersionPolicy" (
    "id" TEXT NOT NULL,
    "platform" "MobilePlatform" NOT NULL,
    "minimumSupportedVersion" VARCHAR(32) NOT NULL,
    "recommendedVersion" VARCHAR(32) NOT NULL,
    "latestVersion" VARCHAR(32) NOT NULL,
    "storeUrl" VARCHAR(300),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileVersionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileRelease" (
    "id" TEXT NOT NULL,
    "platform" "MobilePlatform" NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "buildNumber" INTEGER NOT NULL,
    "environment" VARCHAR(12) NOT NULL DEFAULT 'PRODUCTION',
    "releaseNotes" VARCHAR(2000) NOT NULL,
    "status" "MobileReleaseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "rollbackReferenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileEventCounter" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "platform" "MobilePlatform" NOT NULL,
    "appVersion" VARCHAR(32) NOT NULL,
    "event" VARCHAR(40) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MobileEventCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MobileDevice_installationId_key" ON "MobileDevice"("installationId");

-- CreateIndex
CREATE INDEX "MobileDevice_profileId_status_idx" ON "MobileDevice"("profileId", "status");

-- CreateIndex
CREATE INDEX "MobileDevice_familyMemberId_status_idx" ON "MobileDevice"("familyMemberId", "status");

-- CreateIndex
CREATE INDEX "MobileDevice_pushTokenHash_idx" ON "MobileDevice"("pushTokenHash");

-- CreateIndex
CREATE INDEX "MobileDevice_platform_status_lastSeenAt_idx" ON "MobileDevice"("platform", "status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "MobileDevice_sessionId_idx" ON "MobileDevice"("sessionId");

-- CreateIndex
CREATE INDEX "MobilePushDelivery_deviceId_createdAt_idx" ON "MobilePushDelivery"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "MobilePushDelivery_status_createdAt_idx" ON "MobilePushDelivery"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MobileVersionPolicy_platform_key" ON "MobileVersionPolicy"("platform");

-- CreateIndex
CREATE INDEX "MobileRelease_status_platform_idx" ON "MobileRelease"("status", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "MobileRelease_platform_version_buildNumber_key" ON "MobileRelease"("platform", "version", "buildNumber");

-- CreateIndex
CREATE INDEX "MobileEventCounter_day_idx" ON "MobileEventCounter"("day");

-- CreateIndex
CREATE UNIQUE INDEX "MobileEventCounter_day_platform_appVersion_event_key" ON "MobileEventCounter"("day", "platform", "appVersion", "event");

-- AddForeignKey
ALTER TABLE "MobileDevice" ADD CONSTRAINT "MobileDevice_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileDevice" ADD CONSTRAINT "MobileDevice_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobilePushDelivery" ADD CONSTRAINT "MobilePushDelivery_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "MobileDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

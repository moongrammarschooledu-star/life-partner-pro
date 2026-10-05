-- CreateEnum
CREATE TYPE "EngagementEventType" AS ENUM ('USER_REGISTERED', 'PROFILE_STARTED', 'PROFILE_COMPLETED', 'PROFILE_SUBMITTED', 'VERIFICATION_STARTED', 'VERIFICATION_COMPLETED', 'PROFILE_ACTIVATED', 'MATCH_AVAILABLE', 'MATCH_REVIEW_REQUIRED', 'PROPOSAL_RECEIVED', 'PROPOSAL_SENT', 'PROPOSAL_RESPONSE_PENDING', 'PROPOSAL_RESPONSE_RECEIVED', 'MUTUAL_INTEREST', 'CONTACT_PERMISSION_PENDING', 'CONTACT_APPROVED', 'MEETING_REQUESTED', 'MEETING_SCHEDULED', 'MEETING_COMPLETED', 'FOLLOWUP_DUE', 'PROFILE_UPDATE_REQUESTED', 'SUPPORT_CASE_CREATED', 'MEMBERSHIP_STARTED', 'MEMBERSHIP_EXPIRING', 'SUBSCRIPTION_RENEWAL_DUE', 'REFERRAL_CREATED', 'REFERRAL_REWARDED', 'INACTIVE_USER', 'REENGAGEMENT_ELIGIBLE', 'LOGIN');

-- CreateEnum
CREATE TYPE "EngagementWorkflowStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EngagementRunStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReengagementState" AS ENUM ('NOT_ELIGIBLE', 'ELIGIBLE', 'SCHEDULED', 'SENT', 'RESPONDED', 'COMPLETED', 'OPTED_OUT', 'SUPPRESSED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EngagementActivityState" AS ENUM ('ACTIVE', 'LOW_ACTIVITY', 'INACTIVE', 'REENGAGEMENT_ELIGIBLE', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "EngagementContentStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EngagementAnnouncementStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EngagementFeedbackType" AS ENUM ('PLATFORM', 'FEATURE_REQUEST', 'SUPPORT', 'EXPERIENCE', 'BUG_REPORT', 'MEETING_FOLLOWUP');

-- CreateEnum
CREATE TYPE "EngagementFeedbackStatus" AS ENUM ('NEW', 'IN_REVIEW', 'RESOLVED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "EngagementEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "type" "EngagementEventType" NOT NULL,
    "refType" VARCHAR(40),
    "refId" VARCHAR(60),
    "payload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngagementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementProfileState" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "lastActivityAt" TIMESTAMP(3),
    "lastLoginDay" DATE,
    "activityState" "EngagementActivityState" NOT NULL DEFAULT 'ACTIVE',
    "reengagementAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastReengagementAt" TIMESTAMP(3),
    "reengagementOptOut" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagementProfileState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "maxDailyNotifications" INTEGER NOT NULL DEFAULT 5,
    "maxWeeklyReengagement" INTEGER NOT NULL DEFAULT 2,
    "maxFollowupAttempts" INTEGER NOT NULL DEFAULT 3,
    "maxReengagementAttempts" INTEGER NOT NULL DEFAULT 3,
    "lowActivityAfterDays" INTEGER NOT NULL DEFAULT 14,
    "inactiveAfterDays" INTEGER NOT NULL DEFAULT 30,
    "reengagementCooldownDays" INTEGER NOT NULL DEFAULT 14,
    "reminderMinGapHours" INTEGER NOT NULL DEFAULT 24,
    "quietHoursStart" INTEGER NOT NULL DEFAULT 22,
    "quietHoursEnd" INTEGER NOT NULL DEFAULT 8,
    "defaultTimezone" VARCHAR(40) NOT NULL DEFAULT 'Asia/Karachi',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagementSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementPreference" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quietHoursStart" INTEGER,
    "quietHoursEnd" INTEGER,
    "timezone" VARCHAR(40),
    "maxDailyNotifications" INTEGER,
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "reengagementEnabled" BOOLEAN NOT NULL DEFAULT true,
    "feedbackRequestsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagementPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementWorkflow" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(400),
    "trigger" "EngagementEventType" NOT NULL,
    "status" "EngagementWorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "publishedVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagementWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementWorkflowVersion" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ContentVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "policyScanResult" JSONB,
    "changeSummary" VARCHAR(300),
    "clonedFromVersionId" TEXT,
    "authorId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngagementWorkflowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementWorkflowRun" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "status" "EngagementRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "stepIndex" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastNote" VARCHAR(200),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagementWorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementReminder" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "state" "ReengagementState" NOT NULL DEFAULT 'SCHEDULED',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" VARCHAR(120),
    "runId" TEXT,
    "refType" VARCHAR(40),
    "refId" VARCHAR(60),
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "dedupKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagementReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementContent" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "status" "EngagementContentStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "publishedVersionId" TEXT,
    "publishAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagementContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementContentVersion" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ContentVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(300),
    "body" TEXT NOT NULL,
    "language" VARCHAR(2) NOT NULL DEFAULT 'EN',
    "imageUrl" TEXT,
    "authorName" VARCHAR(80),
    "contentHash" TEXT NOT NULL,
    "policyScanResult" JSONB,
    "authorId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngagementContentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementAnnouncement" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(1200) NOT NULL,
    "language" VARCHAR(2) NOT NULL DEFAULT 'EN',
    "status" "EngagementAnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "targeting" JSONB NOT NULL,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "contentHash" TEXT,
    "policyScanResult" JSONB,
    "createdById" TEXT NOT NULL,
    "reviewerId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagementAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementAnnouncementDismissal" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngagementAnnouncementDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementFeedback" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "type" "EngagementFeedbackType" NOT NULL,
    "subject" VARCHAR(120),
    "message" VARCHAR(2000) NOT NULL,
    "rating" INTEGER,
    "refType" VARCHAR(40),
    "refId" VARCHAR(60),
    "choice" VARCHAR(40),
    "status" "EngagementFeedbackStatus" NOT NULL DEFAULT 'NEW',
    "handledById" TEXT,
    "internalNote" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagementFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementSurvey" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "questions" JSONB NOT NULL,
    "status" "EngagementContentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagementSurvey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementSurveyResponse" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "refKey" VARCHAR(60) NOT NULL DEFAULT '',
    "answers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngagementSurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementDailySnapshot" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "metric" VARCHAR(60) NOT NULL,
    "dimension" VARCHAR(80) NOT NULL DEFAULT 'ALL',
    "value" INTEGER NOT NULL DEFAULT 0,
    "denominator" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngagementDailySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EngagementEvent_eventKey_key" ON "EngagementEvent"("eventKey");

-- CreateIndex
CREATE INDEX "EngagementEvent_profileId_occurredAt_idx" ON "EngagementEvent"("profileId", "occurredAt");

-- CreateIndex
CREATE INDEX "EngagementEvent_type_occurredAt_idx" ON "EngagementEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "EngagementEvent_occurredAt_idx" ON "EngagementEvent"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementProfileState_profileId_key" ON "EngagementProfileState"("profileId");

-- CreateIndex
CREATE INDEX "EngagementProfileState_activityState_idx" ON "EngagementProfileState"("activityState");

-- CreateIndex
CREATE INDEX "EngagementProfileState_lastActivityAt_idx" ON "EngagementProfileState"("lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementPreference_profileId_key" ON "EngagementPreference"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementWorkflow_code_key" ON "EngagementWorkflow"("code");

-- CreateIndex
CREATE INDEX "EngagementWorkflow_status_trigger_idx" ON "EngagementWorkflow"("status", "trigger");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementWorkflowVersion_workflowId_version_key" ON "EngagementWorkflowVersion"("workflowId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementWorkflowRun_code_key" ON "EngagementWorkflowRun"("code");

-- CreateIndex
CREATE INDEX "EngagementWorkflowRun_status_nextRunAt_idx" ON "EngagementWorkflowRun"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "EngagementWorkflowRun_profileId_idx" ON "EngagementWorkflowRun"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementWorkflowRun_workflowId_eventKey_key" ON "EngagementWorkflowRun"("workflowId", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementReminder_dedupKey_key" ON "EngagementReminder"("dedupKey");

-- CreateIndex
CREATE INDEX "EngagementReminder_state_dueAt_idx" ON "EngagementReminder"("state", "dueAt");

-- CreateIndex
CREATE INDEX "EngagementReminder_profileId_kind_idx" ON "EngagementReminder"("profileId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementContent_code_key" ON "EngagementContent"("code");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementContent_slug_key" ON "EngagementContent"("slug");

-- CreateIndex
CREATE INDEX "EngagementContent_status_category_idx" ON "EngagementContent"("status", "category");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementContentVersion_contentId_version_key" ON "EngagementContentVersion"("contentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementAnnouncement_code_key" ON "EngagementAnnouncement"("code");

-- CreateIndex
CREATE INDEX "EngagementAnnouncement_status_startAt_idx" ON "EngagementAnnouncement"("status", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementAnnouncementDismissal_announcementId_profileId_key" ON "EngagementAnnouncementDismissal"("announcementId", "profileId");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementFeedback_code_key" ON "EngagementFeedback"("code");

-- CreateIndex
CREATE INDEX "EngagementFeedback_type_createdAt_idx" ON "EngagementFeedback"("type", "createdAt");

-- CreateIndex
CREATE INDEX "EngagementFeedback_profileId_createdAt_idx" ON "EngagementFeedback"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "EngagementFeedback_status_idx" ON "EngagementFeedback"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementSurvey_code_key" ON "EngagementSurvey"("code");

-- CreateIndex
CREATE INDEX "EngagementSurvey_status_kind_idx" ON "EngagementSurvey"("status", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementSurveyResponse_surveyId_profileId_refKey_key" ON "EngagementSurveyResponse"("surveyId", "profileId", "refKey");

-- CreateIndex
CREATE INDEX "EngagementDailySnapshot_metric_date_idx" ON "EngagementDailySnapshot"("metric", "date");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementDailySnapshot_date_metric_dimension_key" ON "EngagementDailySnapshot"("date", "metric", "dimension");

-- AddForeignKey
ALTER TABLE "EngagementWorkflowVersion" ADD CONSTRAINT "EngagementWorkflowVersion_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "EngagementWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementWorkflowRun" ADD CONSTRAINT "EngagementWorkflowRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "EngagementWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementContentVersion" ADD CONSTRAINT "EngagementContentVersion_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "EngagementContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementAnnouncementDismissal" ADD CONSTRAINT "EngagementAnnouncementDismissal_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "EngagementAnnouncement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementSurveyResponse" ADD CONSTRAINT "EngagementSurveyResponse_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "EngagementSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateEnum
CREATE TYPE "MarketingCampaignStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MarketingObjective" AS ENUM ('LEAD_GENERATION', 'WEBSITE_TRAFFIC', 'REGISTRATION', 'PROFILE_COMPLETION', 'VERIFICATION', 'MEMBERSHIP_PROMOTION', 'REFERRAL_GROWTH', 'AWARENESS', 'EVENT_PROMOTION', 'WHATSAPP_INQUIRY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MarketingChannel" AS ENUM ('WEBSITE', 'FACEBOOK', 'INSTAGRAM', 'META_ADS', 'WHATSAPP', 'TIKTOK', 'YOUTUBE', 'GOOGLE_ADS', 'SEARCH', 'EMAIL', 'SMS', 'REFERRAL', 'DIRECT', 'EVENT', 'OTHER');

-- CreateEnum
CREATE TYPE "MarketingProviderKey" AS ENUM ('SANDBOX', 'META', 'GOOGLE', 'TIKTOK');

-- CreateEnum
CREATE TYPE "MarketingAdLevel" AS ENUM ('AD_CAMPAIGN', 'AD_SET', 'AD_GROUP', 'AD');

-- CreateEnum
CREATE TYPE "MarketingCreativeStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'ACTIVE', 'PAUSED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LandingPageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContentVersionStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "LeadFormStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MarketingConsentPurpose" AS ENUM ('INQUIRY_FOLLOWUP', 'MARKETING_UPDATES', 'WHATSAPP_CONTACT');

-- CreateEnum
CREATE TYPE "AttributionVerification" AS ENUM ('VERIFIED', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "MarketingEventType" AS ENUM ('PAGE_VIEW', 'LANDING_PAGE_VIEW', 'CTA_CLICK', 'FORM_STARTED', 'FORM_SUBMITTED', 'LEAD_CREATED', 'LEAD_DUPLICATE_DETECTED', 'WHATSAPP_STARTED', 'REGISTRATION_STARTED', 'REGISTRATION_COMPLETED', 'PROFILE_COMPLETED', 'VERIFICATION_STARTED', 'VERIFICATION_COMPLETED', 'MEMBERSHIP_STARTED');

-- CreateEnum
CREATE TYPE "SubmissionOutcome" AS ENUM ('ACCEPTED', 'SUPPRESSED', 'DUPLICATE_REVIEW', 'REJECTED_VALIDATION', 'REJECTED_SPAM', 'REJECTED_CONSENT');

-- CreateEnum
CREATE TYPE "MarketingBudgetEventType" AS ENUM ('SET', 'INCREASE_REQUESTED', 'INCREASE_APPROVED', 'DECREASE', 'SPEND_SYNCED', 'ALERT');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('DRAFT', 'RUNNING', 'STOPPED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MarketingConnectionStatus" AS ENUM ('NOT_CONFIGURED', 'CONNECTED', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "MarketingWebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'SKIPPED', 'REJECTED', 'FAILED', 'PENDING_FETCH');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "adNodeId" TEXT,
ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "capturedAt" TIMESTAMP(3),
ADD COLUMN     "clickIdHash" VARCHAR(64),
ADD COLUMN     "clickIdType" VARCHAR(12),
ADD COLUMN     "dedupeReason" VARCHAR(200),
ADD COLUMN     "emailHash" VARCHAR(64),
ADD COLUMN     "formId" TEXT,
ADD COLUMN     "formVersionId" TEXT,
ADD COLUMN     "ipHash" VARCHAR(64),
ADD COLUMN     "landingPageId" TEXT,
ADD COLUMN     "landingPageVersionId" TEXT,
ADD COLUMN     "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phoneHash" VARCHAR(64),
ADD COLUMN     "platform" VARCHAR(40),
ADD COLUMN     "preferredChannel" VARCHAR(20),
ADD COLUMN     "preferredLanguage" VARCHAR(5),
ADD COLUMN     "privacyNoticeVersionId" TEXT,
ADD COLUMN     "providerLeadId" VARCHAR(120),
ADD COLUMN     "utmCampaign" VARCHAR(100),
ADD COLUMN     "utmContent" VARCHAR(100),
ADD COLUMN     "utmMedium" VARCHAR(100),
ADD COLUMN     "utmSource" VARCHAR(100),
ADD COLUMN     "utmTerm" VARCHAR(100);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "objective" "MarketingObjective" NOT NULL DEFAULT 'LEAD_GENERATION',
    "channel" "MarketingChannel" NOT NULL DEFAULT 'WEBSITE',
    "status" "MarketingCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "providerKey" "MarketingProviderKey" NOT NULL DEFAULT 'SANDBOX',
    "campaignKey" TEXT NOT NULL,
    "utmSource" VARCHAR(100),
    "utmMedium" VARCHAR(100),
    "contentIdentifier" VARCHAR(100),
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Karachi',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "currencyCode" TEXT NOT NULL DEFAULT 'PKR',
    "budgetTotalMinor" INTEGER NOT NULL DEFAULT 0,
    "budgetDailyMinor" INTEGER,
    "alertThresholdPct" INTEGER,
    "spendVerifiedMinor" INTEGER NOT NULL DEFAULT 0,
    "spendVerified" BOOLEAN NOT NULL DEFAULT false,
    "attributionModel" VARCHAR(20),
    "language" VARCHAR(5) NOT NULL DEFAULT 'EN',
    "landingPageId" TEXT,
    "formId" TEXT,
    "routingDepartmentId" TEXT,
    "assignedTeamId" TEXT,
    "responsibleAdminId" TEXT,
    "targeting" JSONB,
    "contentHash" TEXT,
    "policyScanResult" JSONB,
    "policyScanAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "launchedAt" TIMESTAMP(3),
    "pausedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingBudgetEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "type" "MarketingBudgetEventType" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "previousMinor" INTEGER,
    "newMinor" INTEGER,
    "currencyCode" TEXT NOT NULL,
    "approvalRequestId" TEXT,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingBudgetEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingProviderConnection" (
    "id" TEXT NOT NULL,
    "providerKey" "MarketingProviderKey" NOT NULL,
    "status" "MarketingConnectionStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "accountExternalId" TEXT,
    "secretRefs" JSONB NOT NULL DEFAULT '[]',
    "environment" TEXT NOT NULL DEFAULT 'SANDBOX',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" VARCHAR(300),
    "webhookStatus" VARCHAR(40),
    "lastWebhookAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingProviderConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAdNode" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "parentId" TEXT,
    "level" "MarketingAdLevel" NOT NULL,
    "providerKey" "MarketingProviderKey" NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PAUSED',
    "targeting" JSONB,
    "creativeId" TEXT,
    "dailyBudgetMinor" INTEGER,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingAdNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCreative" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "campaignId" TEXT,
    "name" TEXT NOT NULL,
    "status" "MarketingCreativeStatus" NOT NULL DEFAULT 'DRAFT',
    "headline" VARCHAR(120) NOT NULL,
    "body" VARCHAR(600) NOT NULL,
    "description" VARCHAR(300),
    "ctaLabel" VARCHAR(40) NOT NULL,
    "language" VARCHAR(5) NOT NULL DEFAULT 'EN',
    "assetKey" VARCHAR(200),
    "contentHash" TEXT,
    "policyScanResult" JSONB,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCreative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingPage" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "LandingPageStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedVersionId" TEXT,
    "language" VARCHAR(5) NOT NULL DEFAULT 'EN',
    "sitemapInclude" BOOLEAN NOT NULL DEFAULT false,
    "noindex" BOOLEAN NOT NULL DEFAULT true,
    "campaignId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandingPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingPageVersion" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ContentVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(160) NOT NULL,
    "metaDescription" VARCHAR(300),
    "canonicalUrl" TEXT,
    "ogTitle" VARCHAR(160),
    "ogDescription" VARCHAR(300),
    "socialImageUrl" TEXT,
    "sections" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "changeSummary" TEXT,
    "clonedFromVersionId" TEXT,
    "policyScanResult" JSONB,
    "authorId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LandingPageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadForm" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "LeadFormStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedVersionId" TEXT,
    "campaignId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadFormVersion" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ContentVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "fields" JSONB NOT NULL,
    "consentConfig" JSONB NOT NULL,
    "privacyNoticeVersionId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "changeSummary" TEXT,
    "authorId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadFormVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadFormSubmission" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "outcome" "SubmissionOutcome" NOT NULL,
    "leadId" TEXT,
    "phoneHash" VARCHAR(64),
    "emailHash" VARCHAR(64),
    "ipHash" VARCHAR(64) NOT NULL,
    "elapsedMs" INTEGER,
    "rejectReason" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadFormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingLeadConsent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "purpose" "MarketingConsentPurpose" NOT NULL,
    "channel" "NotificationChannel",
    "granted" BOOLEAN NOT NULL,
    "textVersionHash" TEXT NOT NULL,
    "privacyNoticeVersionId" TEXT,
    "jurisdictionId" TEXT,
    "method" VARCHAR(20) NOT NULL DEFAULT 'CHECKBOX',
    "ipHash" VARCHAR(64),
    "withdrawnAt" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingLeadConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadAttribution" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "campaignId" TEXT,
    "adNodeId" TEXT,
    "landingPageVersionId" TEXT,
    "verification" "AttributionVerification" NOT NULL,
    "utm" JSONB NOT NULL,
    "clickIdType" VARCHAR(12),
    "clickIdHash" VARCHAR(64),
    "referrerHost" VARCHAR(120),
    "model" VARCHAR(20),
    "touchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingEvent" (
    "id" TEXT NOT NULL,
    "type" "MarketingEventType" NOT NULL,
    "campaignId" TEXT,
    "landingPageId" TEXT,
    "leadId" TEXT,
    "variantKey" VARCHAR(40),
    "subjectHash" VARCHAR(64),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingMetricDaily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "campaignId" TEXT NOT NULL,
    "adNodeKey" TEXT NOT NULL DEFAULT 'CAMPAIGN',
    "providerKey" "MarketingProviderKey" NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "spendMinor" INTEGER NOT NULL DEFAULT 0,
    "providerLeads" INTEGER NOT NULL DEFAULT 0,
    "isSandbox" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingMetricDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAutomationRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" VARCHAR(40) NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingAutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAutomationRun" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "subjectType" VARCHAR(20) NOT NULL,
    "subjectId" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "error" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingAutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingExperiment" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "landingPageId" TEXT,
    "name" TEXT NOT NULL,
    "status" "ExperimentStatus" NOT NULL DEFAULT 'DRAFT',
    "variants" JSONB NOT NULL,
    "primaryMetric" VARCHAR(40) NOT NULL DEFAULT 'LEAD_CREATED',
    "minSampleSize" INTEGER NOT NULL DEFAULT 100,
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingWebhookEvent" (
    "id" TEXT NOT NULL,
    "providerKey" "MarketingProviderKey" NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" "MarketingWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "rejectReason" VARCHAR(120),
    "eventType" VARCHAR(40),
    "leadId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "MarketingWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCampaign_code_key" ON "MarketingCampaign"("code");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCampaign_campaignKey_key" ON "MarketingCampaign"("campaignKey");

-- CreateIndex
CREATE INDEX "MarketingCampaign_status_idx" ON "MarketingCampaign"("status");

-- CreateIndex
CREATE INDEX "MarketingCampaign_providerKey_status_idx" ON "MarketingCampaign"("providerKey", "status");

-- CreateIndex
CREATE INDEX "MarketingBudgetEvent_campaignId_createdAt_idx" ON "MarketingBudgetEvent"("campaignId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingProviderConnection_providerKey_key" ON "MarketingProviderConnection"("providerKey");

-- CreateIndex
CREATE INDEX "MarketingAdNode_campaignId_level_idx" ON "MarketingAdNode"("campaignId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingAdNode_providerKey_externalId_key" ON "MarketingAdNode"("providerKey", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCreative_code_key" ON "MarketingCreative"("code");

-- CreateIndex
CREATE INDEX "MarketingCreative_campaignId_status_idx" ON "MarketingCreative"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LandingPage_code_key" ON "LandingPage"("code");

-- CreateIndex
CREATE UNIQUE INDEX "LandingPage_slug_key" ON "LandingPage"("slug");

-- CreateIndex
CREATE INDEX "LandingPage_status_idx" ON "LandingPage"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LandingPageVersion_pageId_version_key" ON "LandingPageVersion"("pageId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "LeadForm_code_key" ON "LeadForm"("code");

-- CreateIndex
CREATE INDEX "LeadForm_status_idx" ON "LeadForm"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LeadFormVersion_formId_version_key" ON "LeadFormVersion"("formId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "LeadFormSubmission_idempotencyKey_key" ON "LeadFormSubmission"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LeadFormSubmission_formId_createdAt_idx" ON "LeadFormSubmission"("formId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadFormSubmission_ipHash_createdAt_idx" ON "LeadFormSubmission"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingLeadConsent_leadId_purpose_idx" ON "MarketingLeadConsent"("leadId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "LeadAttribution_code_key" ON "LeadAttribution"("code");

-- CreateIndex
CREATE UNIQUE INDEX "LeadAttribution_leadId_key" ON "LeadAttribution"("leadId");

-- CreateIndex
CREATE INDEX "LeadAttribution_campaignId_idx" ON "LeadAttribution"("campaignId");

-- CreateIndex
CREATE INDEX "MarketingEvent_campaignId_type_occurredAt_idx" ON "MarketingEvent"("campaignId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "MarketingEvent_occurredAt_idx" ON "MarketingEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "MarketingMetricDaily_date_idx" ON "MarketingMetricDaily"("date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingMetricDaily_campaignId_adNodeKey_date_key" ON "MarketingMetricDaily"("campaignId", "adNodeKey", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingAutomationRun_ruleId_subjectType_subjectId_key" ON "MarketingAutomationRun"("ruleId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "MarketingExperiment_status_idx" ON "MarketingExperiment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingWebhookEvent_idempotencyKey_key" ON "MarketingWebhookEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MarketingWebhookEvent_providerKey_receivedAt_idx" ON "MarketingWebhookEvent"("providerKey", "receivedAt");

-- CreateIndex
CREATE INDEX "MarketingWebhookEvent_status_idx" ON "MarketingWebhookEvent"("status");

-- CreateIndex
CREATE INDEX "Lead_campaignId_createdAt_idx" ON "Lead"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_emailHash_idx" ON "Lead"("emailHash");

-- CreateIndex
CREATE INDEX "Lead_phoneHash_idx" ON "Lead"("phoneHash");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_platform_providerLeadId_key" ON "Lead"("platform", "providerLeadId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingBudgetEvent" ADD CONSTRAINT "MarketingBudgetEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAdNode" ADD CONSTRAINT "MarketingAdNode_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAdNode" ADD CONSTRAINT "MarketingAdNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MarketingAdNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCreative" ADD CONSTRAINT "MarketingCreative_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingPageVersion" ADD CONSTRAINT "LandingPageVersion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "LandingPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadFormVersion" ADD CONSTRAINT "LeadFormVersion_formId_fkey" FOREIGN KEY ("formId") REFERENCES "LeadForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingLeadConsent" ADD CONSTRAINT "MarketingLeadConsent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAutomationRun" ADD CONSTRAINT "MarketingAutomationRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "MarketingAutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

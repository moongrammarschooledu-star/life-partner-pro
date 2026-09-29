-- CreateEnum
CREATE TYPE "PackageType" AS ENUM ('FREE', 'ONE_TIME', 'SUBSCRIPTION', 'TRIAL', 'PROMOTIONAL', 'CUSTOM', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'SCHEDULED', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TrialEligibilityScope" AS ENUM ('PER_PACKAGE', 'PER_ACCOUNT');

-- CreateEnum
CREATE TYPE "PackageVersionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CouponRedemptionStatus" AS ENUM ('RESERVED', 'REDEEMED', 'RELEASED', 'REVERSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FeatureLimitType" AS ENUM ('UNLIMITED', 'PER_DAY', 'PER_WEEK', 'PER_MONTH', 'PER_BILLING_PERIOD', 'LIFETIME', 'PER_TRANSACTION');

-- CreateEnum
CREATE TYPE "FeatureUsageAction" AS ENUM ('CONSUMED', 'REFUNDED', 'ADMIN_RESET');

-- CreateEnum
CREATE TYPE "EntitlementOverrideType" AS ENUM ('GRANT', 'REVOKE', 'LIMIT_ADJUST');

-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('GRANTED', 'USED', 'REFUNDED', 'EXPIRED', 'REVOKED', 'ADJUSTED');

-- CreateEnum
CREATE TYPE "ReferralRewardType" AS ENUM ('FREE_DAYS', 'CREDIT', 'FEATURE_UNLOCK', 'DISCOUNT', 'COUPON', 'POINTS');

-- CreateEnum
CREATE TYPE "ReferralQualifyingEvent" AS ENUM ('REGISTRATION', 'FIRST_PAYMENT', 'VERIFICATION_COMPLETE', 'SUBSCRIPTION_ACTIVE_N_DAYS');

-- CreateEnum
CREATE TYPE "PromotionLikeStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'LINKED', 'QUALIFIED', 'REWARDED', 'REFERRAL_REVIEW_REQUIRED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReferralRewardStatus" AS ENUM ('PENDING', 'GRANTED', 'REVERSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('PACKAGE_DISCOUNT', 'TRIAL_EXTENSION', 'CREDIT_GRANT', 'FEATURE_UNLOCK');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminTaskType" ADD VALUE 'REFERRAL_REVIEW';
ALTER TYPE "AdminTaskType" ADD VALUE 'COUPON_ISSUE_REVIEW';

-- AlterEnum
ALTER TYPE "AssignmentResourceType" ADD VALUE 'REFERRAL';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PACKAGE_ACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'PACKAGE_ARCHIVED';
ALTER TYPE "AuditAction" ADD VALUE 'PACKAGE_VERSION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PACKAGE_VERSION_ACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'FEATURE_DEFINITION_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'ENTITLEMENT_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'ENTITLEMENT_EXPIRED';
ALTER TYPE "AuditAction" ADD VALUE 'ENTITLEMENT_OVERRIDE';
ALTER TYPE "AuditAction" ADD VALUE 'USAGE_CONSUMED';
ALTER TYPE "AuditAction" ADD VALUE 'USAGE_REFUNDED';
ALTER TYPE "AuditAction" ADD VALUE 'USAGE_RESET';
ALTER TYPE "AuditAction" ADD VALUE 'SUBSCRIPTION_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'COUPON_REDEEMED';
ALTER TYPE "AuditAction" ADD VALUE 'COUPON_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'PROMOTION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PROMOTION_ACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'PROMOTION_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'REFERRAL_PROGRAM_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'REFERRAL_PROGRAM_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'REFERRAL_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'REFERRAL_QUALIFIED';
ALTER TYPE "AuditAction" ADD VALUE 'REFERRAL_REWARDED';
ALTER TYPE "AuditAction" ADD VALUE 'REFERRAL_REVERSED';
ALTER TYPE "AuditAction" ADD VALUE 'CREDIT_GRANTED';
ALTER TYPE "AuditAction" ADD VALUE 'CREDIT_USED';
ALTER TYPE "AuditAction" ADD VALUE 'CREDIT_REVOKED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DiscountType" ADD VALUE 'FREE_TRIAL';
ALTER TYPE "DiscountType" ADD VALUE 'FREE_FEATURE';
ALTER TYPE "DiscountType" ADD VALUE 'CREDIT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'TRIAL_STARTED';
ALTER TYPE "NotificationType" ADD VALUE 'TRIAL_ENDING';
ALTER TYPE "NotificationType" ADD VALUE 'PACKAGE_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'COUPON_APPLIED';
ALTER TYPE "NotificationType" ADD VALUE 'COUPON_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE 'REFERRAL_REWARD_GRANTED';
ALTER TYPE "NotificationType" ADD VALUE 'ENTITLEMENT_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE 'ADMIN_REFERRAL_REVIEW_REQUIRED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityEventType" ADD VALUE 'COUPON_ABUSE_SUSPECTED';
ALTER TYPE "SecurityEventType" ADD VALUE 'REFERRAL_ABUSE_SUSPECTED';
ALTER TYPE "SecurityEventType" ADD VALUE 'ENTITLEMENT_BYPASS_ATTEMPT';
ALTER TYPE "SecurityEventType" ADD VALUE 'UNUSUAL_TRANSACTION_PATTERN';

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "couponsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "creditsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "promotionsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "referralsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "renewalsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "allowedCountries" JSONB,
ADD COLUMN     "allowedSubscriptionTypes" JSONB,
ADD COLUMN     "campaignKey" TEXT,
ADD COLUMN     "currencyCode" TEXT,
ADD COLUMN     "firstTimeUserOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "freeFeatureKey" TEXT,
ADD COLUMN     "requiresReferralEligibility" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CouponRedemption" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "reservedAt" TIMESTAMP(3),
ADD COLUMN     "status" "CouponRedemptionStatus" NOT NULL DEFAULT 'REDEEMED',
ALTER COLUMN "orderId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "packageVersionId" TEXT;

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "currentVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "packageType" "PackageType" NOT NULL DEFAULT 'SUBSCRIPTION',
ADD COLUMN     "status" "PackageStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "trialEligibilityScope" "TrialEligibilityScope" NOT NULL DEFAULT 'PER_ACCOUNT';

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "cancelInitiatedBy" TEXT,
ADD COLUMN     "packagePriceId" TEXT,
ADD COLUMN     "packageVersionId" TEXT,
ADD COLUMN     "pendingPackageId" TEXT;

-- CreateTable
CREATE TABLE "PackageVersion" (
    "id" TEXT NOT NULL,
    "versionCode" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "previousVersion" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "packageType" "PackageType" NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "featuresSnapshot" JSONB NOT NULL,
    "limitsSnapshot" JSONB NOT NULL,
    "changeReason" TEXT NOT NULL,
    "status" "PackageVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "approvedById" TEXT,
    "effectiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "usageLimitType" "FeatureLimitType" NOT NULL DEFAULT 'UNLIMITED',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureUsageLedger" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "action" "FeatureUsageAction" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "requestId" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "reversedLedgerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureUsageLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntitlementOverride" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "overrideType" "EntitlementOverrideType" NOT NULL,
    "limitValue" INTEGER,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdBySystem" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntitlementOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipCredit" (
    "id" TEXT NOT NULL,
    "creditCode" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "balanceMinor" INTEGER NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "type" "CreditTransactionType" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralProgram" (
    "id" TEXT NOT NULL,
    "programCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rewardType" "ReferralRewardType" NOT NULL,
    "rewardConfig" JSONB NOT NULL,
    "qualifyingEvent" "ReferralQualifyingEvent" NOT NULL,
    "qualifyingEventConfig" JSONB,
    "maxRewardsPerReferrer" INTEGER,
    "maxReferralsPerPeriod" INTEGER,
    "periodDays" INTEGER,
    "status" "PromotionLikeStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referralCodeId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "referrerProfileId" TEXT NOT NULL,
    "refereeProfileId" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "linkedAt" TIMESTAMP(3),
    "qualifiedAt" TIMESTAMP(3),
    "rewardedAt" TIMESTAMP(3),
    "fraudFlags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralEvent" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralReward" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "beneficiaryProfileId" TEXT NOT NULL,
    "rewardType" "ReferralRewardType" NOT NULL,
    "rewardConfig" JSONB NOT NULL,
    "status" "ReferralRewardStatus" NOT NULL DEFAULT 'PENDING',
    "grantedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralRewardTransaction" (
    "id" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralRewardTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "promotionCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "promotionType" "PromotionType" NOT NULL,
    "config" JSONB NOT NULL,
    "status" "PromotionLikeStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdById" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionRule" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "ruleConfig" JSONB NOT NULL,

    CONSTRAINT "PromotionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionPackage" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,

    CONSTRAINT "PromotionPackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PackageVersion_versionCode_key" ON "PackageVersion"("versionCode");

-- CreateIndex
CREATE INDEX "PackageVersion_packageId_versionNumber_idx" ON "PackageVersion"("packageId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureDefinition_key_key" ON "FeatureDefinition"("key");

-- CreateIndex
CREATE INDEX "FeatureDefinition_active_idx" ON "FeatureDefinition"("active");

-- CreateIndex
CREATE INDEX "FeatureUsageLedger_profileId_featureKey_createdAt_idx" ON "FeatureUsageLedger"("profileId", "featureKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureUsageLedger_featureKey_requestId_key" ON "FeatureUsageLedger"("featureKey", "requestId");

-- CreateIndex
CREATE INDEX "EntitlementOverride_profileId_featureKey_expiresAt_idx" ON "EntitlementOverride"("profileId", "featureKey", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipCredit_creditCode_key" ON "MembershipCredit"("creditCode");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipCredit_profileId_currencyCode_key" ON "MembershipCredit"("profileId", "currencyCode");

-- CreateIndex
CREATE INDEX "CreditTransaction_creditId_createdAt_idx" ON "CreditTransaction"("creditId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralProgram_programCode_key" ON "ReferralProgram"("programCode");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_code_key" ON "ReferralCode"("code");

-- CreateIndex
CREATE INDEX "ReferralCode_profileId_idx" ON "ReferralCode"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_refereeProfileId_key" ON "Referral"("refereeProfileId");

-- CreateIndex
CREATE INDEX "Referral_referrerProfileId_idx" ON "Referral"("referrerProfileId");

-- CreateIndex
CREATE INDEX "Referral_status_idx" ON "Referral"("status");

-- CreateIndex
CREATE INDEX "ReferralEvent_referralId_idx" ON "ReferralEvent"("referralId");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_promotionCode_key" ON "Promotion"("promotionCode");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionPackage_promotionId_packageId_key" ON "PromotionPackage"("promotionId", "packageId");

-- CreateIndex
CREATE INDEX "CouponRedemption_couponId_status_idx" ON "CouponRedemption"("couponId", "status");

-- CreateIndex
CREATE INDEX "Package_status_idx" ON "Package"("status");

-- AddForeignKey
ALTER TABLE "PackageVersion" ADD CONSTRAINT "PackageVersion_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageVersion" ADD CONSTRAINT "PackageVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageVersion" ADD CONSTRAINT "PackageVersion_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_packagePriceId_fkey" FOREIGN KEY ("packagePriceId") REFERENCES "PackagePrice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_packageVersionId_fkey" FOREIGN KEY ("packageVersionId") REFERENCES "PackageVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntitlementOverride" ADD CONSTRAINT "EntitlementOverride_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntitlementOverride" ADD CONSTRAINT "EntitlementOverride_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "MembershipCredit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_programId_fkey" FOREIGN KEY ("programId") REFERENCES "ReferralProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES "ReferralCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_programId_fkey" FOREIGN KEY ("programId") REFERENCES "ReferralProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralEvent" ADD CONSTRAINT "ReferralEvent_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralRewardTransaction" ADD CONSTRAINT "ReferralRewardTransaction_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "ReferralReward"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRule" ADD CONSTRAINT "PromotionRule_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionPackage" ADD CONSTRAINT "PromotionPackage_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionPackage" ADD CONSTRAINT "PromotionPackage_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


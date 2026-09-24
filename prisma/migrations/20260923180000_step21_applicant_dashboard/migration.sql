-- STEP 21 — Applicant Dashboard, Profile Management, Proposal Response &
-- Family Interaction Portal. Purely additive: 14 new AuditAction values, 1
-- new CaseCategory value, and 1 new table (DashboardPreference). No
-- existing table, column, or enum value is altered or removed.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PHOTO_UPLOADED';
ALTER TYPE "AuditAction" ADD VALUE 'PHOTO_REPLACED';
ALTER TYPE "AuditAction" ADD VALUE 'PHOTO_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'PHOTO_SET_PRIMARY';
ALTER TYPE "AuditAction" ADD VALUE 'PARTNER_PREFERENCE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'LIFESTYLE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'CONTACT_PERMISSION_GRANTED_BY_APPLICANT';
ALTER TYPE "AuditAction" ADD VALUE 'CONTACT_PERMISSION_REVOKED_BY_APPLICANT';
ALTER TYPE "AuditAction" ADD VALUE 'MEETING_CONFIRMED_BY_APPLICANT';
ALTER TYPE "AuditAction" ADD VALUE 'MEETING_RESCHEDULE_REQUESTED_BY_APPLICANT';
ALTER TYPE "AuditAction" ADD VALUE 'MEETING_CANCELLED_BY_APPLICANT';
ALTER TYPE "AuditAction" ADD VALUE 'FAMILY_INTERACTION_REQUEST_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'DASHBOARD_PREFERENCE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'AI_APPLICANT_FEATURE_USED';

-- AlterEnum
ALTER TYPE "CaseCategory" ADD VALUE 'FAMILY_INTERACTION_REQUEST';

-- CreateTable
CREATE TABLE "DashboardPreference" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "pinnedWidgets" TEXT,
    "collapsedCards" TEXT,
    "lastVisitedTab" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DashboardPreference_profileId_key" ON "DashboardPreference"("profileId");

-- AddForeignKey
ALTER TABLE "DashboardPreference" ADD CONSTRAINT "DashboardPreference_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

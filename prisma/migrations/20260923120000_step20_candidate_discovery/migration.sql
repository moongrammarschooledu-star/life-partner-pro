-- STEP 20 — Advanced Search, Smart Filtering, Candidate Discovery &
-- Matchmaking Workspace. Purely additive: 2 new enums, 5 new tables, and
-- enum-value additions to AdminTaskType/AuditAction. No existing table,
-- column, or enum value is altered or removed.

-- CreateEnum
CREATE TYPE "SavedSearchVisibility" AS ENUM ('PRIVATE', 'TEAM', 'DEPARTMENT', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "ShortlistStatus" AS ENUM ('DRAFT', 'REVIEWING', 'READY_FOR_PROPOSAL', 'ARCHIVED');

-- AlterEnum
ALTER TYPE "AdminTaskType" ADD VALUE 'CANDIDATE_REVIEW';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'SEARCH_PERFORMED';
ALTER TYPE "AuditAction" ADD VALUE 'SENSITIVE_SEARCH_PERFORMED';
ALTER TYPE "AuditAction" ADD VALUE 'SAVED_SEARCH_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'SAVED_SEARCH_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'SAVED_SEARCH_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'SHORTLIST_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'SHORTLIST_ITEM_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'SHORTLIST_ITEM_REMOVED';
ALTER TYPE "AuditAction" ADD VALUE 'SHORTLIST_STATUS_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'CANDIDATE_COMPARED';
ALTER TYPE "AuditAction" ADD VALUE 'MUTUAL_MATCH_SEARCH_PERFORMED';
ALTER TYPE "AuditAction" ADD VALUE 'SEARCH_EXPORT_PERFORMED';

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL,
    "searchCode" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "filterJson" JSONB NOT NULL,
    "visibility" "SavedSearchVisibility" NOT NULL DEFAULT 'PRIVATE',
    "departmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchHistory" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "searchType" TEXT NOT NULL,
    "sourceProfileId" TEXT,
    "filterSummary" JSONB NOT NULL,
    "resultCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shortlist" (
    "id" TEXT NOT NULL,
    "shortlistCode" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sourceProfileId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ShortlistStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shortlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortlistItem" (
    "id" TEXT NOT NULL,
    "shortlistId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "adminNote" TEXT,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateSearchAudit" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "searchType" TEXT NOT NULL,
    "sourceProfileId" TEXT,
    "sensitiveFiltersUsed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resultCount" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateSearchAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SavedSearch_searchCode_key" ON "SavedSearch"("searchCode");

-- CreateIndex
CREATE INDEX "SavedSearch_ownerId_idx" ON "SavedSearch"("ownerId");

-- CreateIndex
CREATE INDEX "SavedSearch_visibility_idx" ON "SavedSearch"("visibility");

-- CreateIndex
CREATE INDEX "SearchHistory_actorId_createdAt_idx" ON "SearchHistory"("actorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Shortlist_shortlistCode_key" ON "Shortlist"("shortlistCode");

-- CreateIndex
CREATE INDEX "Shortlist_ownerId_idx" ON "Shortlist"("ownerId");

-- CreateIndex
CREATE INDEX "Shortlist_sourceProfileId_idx" ON "Shortlist"("sourceProfileId");

-- CreateIndex
CREATE INDEX "ShortlistItem_shortlistId_idx" ON "ShortlistItem"("shortlistId");

-- CreateIndex
CREATE UNIQUE INDEX "ShortlistItem_shortlistId_profileId_key" ON "ShortlistItem"("shortlistId", "profileId");

-- CreateIndex
CREATE INDEX "CandidateSearchAudit_actorId_createdAt_idx" ON "CandidateSearchAudit"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchHistory" ADD CONSTRAINT "SearchHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchHistory" ADD CONSTRAINT "SearchHistory_sourceProfileId_fkey" FOREIGN KEY ("sourceProfileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shortlist" ADD CONSTRAINT "Shortlist_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shortlist" ADD CONSTRAINT "Shortlist_sourceProfileId_fkey" FOREIGN KEY ("sourceProfileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortlistItem" ADD CONSTRAINT "ShortlistItem_shortlistId_fkey" FOREIGN KEY ("shortlistId") REFERENCES "Shortlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortlistItem" ADD CONSTRAINT "ShortlistItem_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortlistItem" ADD CONSTRAINT "ShortlistItem_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSearchAudit" ADD CONSTRAINT "CandidateSearchAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSearchAudit" ADD CONSTRAINT "CandidateSearchAudit_sourceProfileId_fkey" FOREIGN KEY ("sourceProfileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

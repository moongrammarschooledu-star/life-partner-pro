-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STAFF',
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "dateOfBirth" DATETIME NOT NULL,
    "maritalStatus" TEXT NOT NULL,
    "heightCm" INTEGER NOT NULL,
    "city" TEXT NOT NULL,
    "area" TEXT,
    "country" TEXT NOT NULL,
    "nationality" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "softDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ContactInfo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "whatsappNumber" TEXT,
    "email" TEXT NOT NULL,
    "preferredContactMethod" TEXT NOT NULL DEFAULT 'PHONE',
    CONSTRAINT "ContactInfo_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EducationInfo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "degree" TEXT,
    "institution" TEXT,
    CONSTRAINT "EducationInfo_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProfessionInfo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "profession" TEXT NOT NULL,
    "jobTitle" TEXT,
    "companyName" TEXT,
    "employmentType" TEXT NOT NULL DEFAULT 'PRIVATE',
    "monthlyIncome" INTEGER,
    "annualIncome" INTEGER,
    "workLocation" TEXT,
    "businessDetails" TEXT,
    CONSTRAINT "ProfessionInfo_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FamilyInfo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "fatherOccupation" TEXT,
    "motherOccupation" TEXT,
    "numberOfBrothers" INTEGER NOT NULL DEFAULT 0,
    "numberOfSisters" INTEGER NOT NULL DEFAULT 0,
    "familyType" TEXT NOT NULL DEFAULT 'NUCLEAR',
    "familyStatus" TEXT NOT NULL DEFAULT 'MIDDLE_CLASS',
    "familyLocation" TEXT,
    "familyBackground" TEXT,
    "additionalInfo" TEXT,
    CONSTRAINT "FamilyInfo_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LifestyleInfo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "religion" TEXT,
    "sect" TEXT,
    "religiousPractice" TEXT,
    "languages" TEXT,
    "smoking" BOOLEAN NOT NULL DEFAULT false,
    "drinking" BOOLEAN NOT NULL DEFAULT false,
    "otherPreferences" TEXT,
    CONSTRAINT "LifestyleInfo_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PartnerPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "minAge" INTEGER,
    "maxAge" INTEGER,
    "preferredCountry" TEXT,
    "preferredCity" TEXT,
    "preferredArea" TEXT,
    "minEducation" TEXT,
    "preferredEducation" TEXT,
    "professionPreference" TEXT,
    "minIncome" INTEGER,
    "maxIncome" INTEGER,
    "incomeFlexible" BOOLEAN NOT NULL DEFAULT true,
    "maritalStatusPreference" TEXT,
    "minHeightCm" INTEGER,
    "maxHeightCm" INTEGER,
    "familyTypePreference" TEXT,
    "familyBackgroundPreference" TEXT,
    "otherFamilyRequirements" TEXT,
    "additionalExpectations" TEXT,
    CONSTRAINT "PartnerPreference_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProfilePhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProfilePhoto_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "agreedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash" TEXT,
    CONSTRAINT "ConsentRecord_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PendingUpdate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PendingUpdate_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProfileNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProfileNote_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProfileNote_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileAId" TEXT NOT NULL,
    "profileBId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "breakdown" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Match_profileAId_fkey" FOREIGN KEY ("profileAId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Match_profileBId_fkey" FOREIGN KEY ("profileBId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileAId" TEXT NOT NULL,
    "profileBId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Proposal_profileAId_fkey" FOREIGN KEY ("profileAId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Proposal_profileBId_fkey" FOREIGN KEY ("profileBId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Proposal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProposalEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposalId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProposalEvent_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Communication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "notes" TEXT,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followUpDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Communication_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Communication_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "note" TEXT,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FollowUp_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContactShareLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileAId" TEXT NOT NULL,
    "profileBId" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "sharedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactShareLog_profileAId_fkey" FOREIGN KEY ("profileAId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContactShareLog_profileBId_fkey" FOREIGN KEY ("profileBId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContactShareLog_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "AdminUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminId" TEXT,
    "action" TEXT NOT NULL,
    "targetProfileId" TEXT,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_targetProfileId_fkey" FOREIGN KEY ("targetProfileId") REFERENCES "Profile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "appName" TEXT NOT NULL DEFAULT 'Life Partner Pro',
    "contactEmail" TEXT,
    "contactWhatsapp" TEXT,
    "contactAddress" TEXT,
    "weightAge" INTEGER NOT NULL DEFAULT 15,
    "weightLocation" INTEGER NOT NULL DEFAULT 15,
    "weightEducation" INTEGER NOT NULL DEFAULT 10,
    "weightProfession" INTEGER NOT NULL DEFAULT 10,
    "weightIncome" INTEGER NOT NULL DEFAULT 10,
    "weightMaritalStatus" INTEGER NOT NULL DEFAULT 10,
    "weightHeight" INTEGER NOT NULL DEFAULT 5,
    "weightFamily" INTEGER NOT NULL DEFAULT 10,
    "weightReligious" INTEGER NOT NULL DEFAULT 10,
    "weightLifestyle" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProfileCodeCounter" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "lastSeq" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_profileCode_key" ON "Profile"("profileCode");

-- CreateIndex
CREATE INDEX "Profile_gender_status_idx" ON "Profile"("gender", "status");

-- CreateIndex
CREATE INDEX "Profile_city_idx" ON "Profile"("city");

-- CreateIndex
CREATE INDEX "Profile_status_idx" ON "Profile"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ContactInfo_profileId_key" ON "ContactInfo"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "EducationInfo_profileId_key" ON "EducationInfo"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionInfo_profileId_key" ON "ProfessionInfo"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyInfo_profileId_key" ON "FamilyInfo"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "LifestyleInfo_profileId_key" ON "LifestyleInfo"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerPreference_profileId_key" ON "PartnerPreference"("profileId");

-- CreateIndex
CREATE INDEX "ProfilePhoto_profileId_idx" ON "ProfilePhoto"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentRecord_profileId_key" ON "ConsentRecord"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "PendingUpdate_profileId_key" ON "PendingUpdate"("profileId");

-- CreateIndex
CREATE INDEX "ProfileNote_profileId_idx" ON "ProfileNote"("profileId");

-- CreateIndex
CREATE INDEX "Match_profileAId_idx" ON "Match"("profileAId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_profileAId_profileBId_key" ON "Match"("profileAId", "profileBId");

-- CreateIndex
CREATE INDEX "Proposal_profileAId_idx" ON "Proposal"("profileAId");

-- CreateIndex
CREATE INDEX "Proposal_profileBId_idx" ON "Proposal"("profileBId");

-- CreateIndex
CREATE INDEX "ProposalEvent_proposalId_idx" ON "ProposalEvent"("proposalId");

-- CreateIndex
CREATE INDEX "Communication_profileId_idx" ON "Communication"("profileId");

-- CreateIndex
CREATE INDEX "FollowUp_dueDate_done_idx" ON "FollowUp"("dueDate", "done");

-- CreateIndex
CREATE INDEX "FollowUp_profileId_idx" ON "FollowUp"("profileId");

-- CreateIndex
CREATE INDEX "ContactShareLog_profileAId_idx" ON "ContactShareLog"("profileAId");

-- CreateIndex
CREATE INDEX "ContactShareLog_profileBId_idx" ON "ContactShareLog"("profileBId");

-- CreateIndex
CREATE INDEX "AuditLog_targetProfileId_idx" ON "AuditLog"("targetProfileId");

-- CreateIndex
CREATE INDEX "AuditLog_adminId_idx" ON "AuditLog"("adminId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

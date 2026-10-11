-- STEP 32: three settings columns added after the first tables migration had already been applied (never edit an applied migration).
-- AlterTable
ALTER TABLE "SocSettings" ADD COLUMN IF NOT EXISTS "enforceMfaPrivileged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SocSettings" ADD COLUMN IF NOT EXISTS "lastDetectionAt" TIMESTAMP(3);
ALTER TABLE "SocSettings" ADD COLUMN IF NOT EXISTS "lastDetectionSummary" JSONB;

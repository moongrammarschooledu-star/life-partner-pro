-- STEP 34: emergency switch for NEW contact shares (additive; default off, so nothing changes until an administrator turns it on).
ALTER TABLE "SystemControl" ADD COLUMN "emergencyContactSharingDisabled" BOOLEAN NOT NULL DEFAULT false;

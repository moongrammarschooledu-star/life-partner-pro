-- STEP 33: exact mobile-number lookups (duplicate detection at registration, risk signals, duplicate clusters) were a sequential scan.
-- Additive and non-destructive. The table is small today, so a plain CREATE INDEX is instant; no CONCURRENTLY is needed.
CREATE INDEX "ContactInfo_mobileNumber_idx" ON "ContactInfo"("mobileNumber");

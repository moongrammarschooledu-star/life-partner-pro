-- Profiles that were verified before verification started to move the status on: they were left as NEW (or UNDER_REVIEW), so a checked profile could not be told apart
-- from one that has just arrived. Bring them in line with what verification now does:
--   * ACTIVE when the three required consents (privacy, matchmaking, terms) are recorded (the same rule the manual status change applies),
--   * VERIFIED otherwise.
-- Only NEW / UNDER_REVIEW profiles that are verified and not deleted are touched; anything further along (matching, proposals, finalised...) or rejected / archived / suspended is left alone.
UPDATE "Profile" AS p
SET "status" = 'ACTIVE'
WHERE p."verified" = true
  AND p."softDeleted" = false
  AND p."status" IN ('NEW', 'UNDER_REVIEW')
  AND EXISTS (
    SELECT 1 FROM "ConsentRecord" c
    WHERE c."profileId" = p."id" AND c."privacyConsent" = true AND c."matchmakingConsent" = true AND c."termsAccepted" = true
  );

UPDATE "Profile"
SET "status" = 'VERIFIED'
WHERE "verified" = true
  AND "softDeleted" = false
  AND "status" IN ('NEW', 'UNDER_REVIEW');

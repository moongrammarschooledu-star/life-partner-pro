-- STEP 17 — one-time default role remap for existing AdminUser rows.
-- This is a separate migration (not folded into the enum-adding migration
-- immediately before it) because PostgreSQL will not let a freshly added
-- enum value (ALTER TYPE ... ADD VALUE) be referenced until that ALTER TYPE
-- has committed — using it in the same transaction fails with
-- "unsafe use of new value of enum type".
--
-- Mapping (disclosed in the STEP 17 RBAC & Permission Audit Report):
--   ADMIN -> OPERATIONS_ADMIN  (closest existing broad-access successor)
--   STAFF -> STAFF_MATCHMAKER  (closest existing assignment-scoped successor;
--                               STAFF's permissions today are matchmaking/
--                               verification/support/communication all mixed
--                               together, so this is a starting point, not a
--                               precise fit)
-- This is a reviewable default, not a final decision — reassign any admin
-- who needs a different one of the 13 roles from the Admin Users page after
-- this migration runs. The legacy "ADMIN"/"STAFF" enum labels are kept (never
-- dropped) so this UPDATE is safe to run more than once and never orphans a
-- row that was already reassigned.
UPDATE "AdminUser" SET "role" = 'OPERATIONS_ADMIN' WHERE "role" = 'ADMIN';
UPDATE "AdminUser" SET "role" = 'STAFF_MATCHMAKER' WHERE "role" = 'STAFF';

-- CustomRole.baseRole rows created before STEP 17 only ever used STAFF/VIEWER
-- as their row-scoping shape; remap STAFF the same way so a pre-existing
-- custom role keeps behaving as "assignment-scoped" (STAFF_MATCHMAKER has the
-- same row-scoping shape as legacy STAFF — see hasBroadRecordAccess() in
-- src/lib/permissions.ts). VIEWER-based custom roles are unaffected.
UPDATE "CustomRole" SET "baseRole" = 'STAFF_MATCHMAKER' WHERE "baseRole" = 'STAFF';

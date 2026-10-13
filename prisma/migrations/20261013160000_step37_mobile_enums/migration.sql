-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'MOBILE_VERSION_POLICY_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'MOBILE_RELEASE_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'MOBILE_PUSH_TEST_SENT';
ALTER TYPE "AuditAction" ADD VALUE 'MOBILE_DEVICE_REMOVED_BY_ADMIN';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityEventType" ADD VALUE 'MOBILE_DEVICE_REGISTERED';
ALTER TYPE "SecurityEventType" ADD VALUE 'MOBILE_DEVICE_REMOVED';
ALTER TYPE "SecurityEventType" ADD VALUE 'MOBILE_SESSION_CREATED';
ALTER TYPE "SecurityEventType" ADD VALUE 'MOBILE_SESSION_REVOKED';
ALTER TYPE "SecurityEventType" ADD VALUE 'MOBILE_PUSH_TOKEN_CHANGED';
ALTER TYPE "SecurityEventType" ADD VALUE 'MOBILE_LOGIN_FAILED';
ALTER TYPE "SecurityEventType" ADD VALUE 'MOBILE_BIOMETRIC_ENABLED';
ALTER TYPE "SecurityEventType" ADD VALUE 'MOBILE_BIOMETRIC_DISABLED';
ALTER TYPE "SecurityEventType" ADD VALUE 'MOBILE_DEEP_LINK_OPENED';
ALTER TYPE "SecurityEventType" ADD VALUE 'MOBILE_APP_UPDATED';
ALTER TYPE "SecurityEventType" ADD VALUE 'MOBILE_SECURITY_WARNING';

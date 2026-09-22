-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('VIEW', 'COMMENT', 'EDIT', 'MANAGE', 'APPROVE', 'OWNER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminRole" ADD VALUE 'OPERATIONS_ADMIN';
ALTER TYPE "AdminRole" ADD VALUE 'MATCHMAKING_MANAGER';
ALTER TYPE "AdminRole" ADD VALUE 'VERIFICATION_MANAGER';
ALTER TYPE "AdminRole" ADD VALUE 'SUPPORT_MANAGER';
ALTER TYPE "AdminRole" ADD VALUE 'COMMUNICATION_MANAGER';
ALTER TYPE "AdminRole" ADD VALUE 'FINANCE_MANAGER';
ALTER TYPE "AdminRole" ADD VALUE 'STAFF_MATCHMAKER';
ALTER TYPE "AdminRole" ADD VALUE 'VERIFICATION_STAFF';
ALTER TYPE "AdminRole" ADD VALUE 'SUPPORT_STAFF';
ALTER TYPE "AdminRole" ADD VALUE 'COMMUNICATION_STAFF';
ALTER TYPE "AdminRole" ADD VALUE 'REPORTING_ANALYST';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_ROLE_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_ROLE_REMOVED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_PERMISSION_GRANTED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_PERMISSION_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_SENSITIVE_PERMISSION_GRANTED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_SENSITIVE_PERMISSION_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'ASSIGNMENT_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'ASSIGNMENT_EXPIRED';
ALTER TYPE "AuditAction" ADD VALUE 'ASSIGNMENT_ACCESS_LEVEL_CHANGED';

-- AlterTable
ALTER TABLE "AdminAssignment" ADD COLUMN     "accessLevel" "AccessLevel" NOT NULL DEFAULT 'MANAGE',
ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CustomRole" ADD COLUMN     "allowedRecordTypes" "AssignmentResourceType"[] DEFAULT ARRAY[]::"AssignmentResourceType"[],
ADD COLUMN     "defaultAccessLevel" "AccessLevel";


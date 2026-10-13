-- AlterEnum (enum values only; used by application code at run time, never in this transaction)
ALTER TYPE "AuditAction" ADD VALUE 'CONTENT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CONTENT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'CONTENT_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'CONTENT_PUBLISHED';
ALTER TYPE "AuditAction" ADD VALUE 'CONTENT_ARCHIVED';
ALTER TYPE "AuditAction" ADD VALUE 'CONTENT_DELETED';

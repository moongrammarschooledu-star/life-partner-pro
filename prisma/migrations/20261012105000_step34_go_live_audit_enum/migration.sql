-- AlterEnum (enum values only; used by code in the next migration's release, never in this transaction)
ALTER TYPE "AuditAction" ADD VALUE 'GO_LIVE_MARKED_READY';
ALTER TYPE "AuditAction" ADD VALUE 'GO_LIVE_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'GO_LIVE_RECORDED_LIVE';
ALTER TYPE "AuditAction" ADD VALUE 'GO_LIVE_BLOCKED';

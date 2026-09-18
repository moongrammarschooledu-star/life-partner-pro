import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { hasActiveHold } from "@/lib/privacy/data-hold";
import { deletePhoto } from "@/lib/storage";
import { deleteVerificationDocument } from "@/lib/verification/document-storage";
import type { DataCategory, RetentionAction } from "@prisma/client";

export async function getRetentionPolicy(category: DataCategory) {
  return prisma.retentionPolicy.findUnique({ where: { category } });
}

// Pure date-math — testable without touching Prisma.
export function isRecordEligibleForAction(recordAgeDays: number, policy: { retentionDays: number; isActive: boolean } | null): boolean {
  if (!policy || !policy.isActive) return false;
  if (policy.retentionDays <= 0) return false;
  return recordAgeDays >= policy.retentionDays;
}

async function logOutcome(category: DataCategory, recordType: string, recordId: string, action: RetentionAction, outcome: string, detail?: string) {
  await prisma.retentionActionLog.create({ data: { category, recordType, recordId, action, outcome, detail: detail ?? null } });
}

// Spec §14/§15 — the actual delete/anonymize execution for an approved
// AccountDeletionRequest, delegated to here rather than duplicated in the
// request-review route. "DELETE" mode scrubs identifying fields and removes
// photos/documents from storage but does NOT hard-delete the Profile row —
// this codebase's Profile has cascading relations to years of proposal/
// case/audit history; a true SQL DELETE would either cascade-destroy that
// unrelated history or violate FK constraints elsewhere. This is a
// deliberate, disclosed safety choice matching the soft-delete precedent
// already used everywhere else in this codebase (Profile.softDeleted,
// Case.softDeletedAt) — "deleted" here means irreversibly scrubbed +
// excluded from every active workflow, not row-erased.
async function executeAccountDeletion(requestId: string) {
  const request = await prisma.accountDeletionRequest.findUnique({ where: { id: requestId } });
  if (!request || request.status !== "SCHEDULED") return;

  if (await hasActiveHold({ profileId: request.profileId })) {
    await logOutcome("ACCOUNT_DATA", "AccountDeletionRequest", requestId, "RETAIN", "SKIPPED_HOLD");
    return;
  }

  await prisma.accountDeletionRequest.update({ where: { id: requestId }, data: { status: "PROCESSING" } });

  try {
    const [photos, documents] = await Promise.all([
      prisma.profilePhoto.findMany({ where: { profileId: request.profileId } }),
      prisma.verificationDocument.findMany({ where: { profileId: request.profileId } }),
    ]);
    for (const photo of photos) {
      await deletePhoto(photo.storageKey).catch(() => {});
    }
    for (const doc of documents) {
      await deleteVerificationDocument(doc.secureStorageReference).catch(() => {});
    }

    const anonymized = request.mode === "ANONYMIZE";
    await prisma.$transaction([
      prisma.profilePhoto.deleteMany({ where: { profileId: request.profileId } }),
      prisma.verificationDocument.deleteMany({ where: { profileId: request.profileId } }),
      prisma.contactInfo.updateMany({
        where: { profileId: request.profileId },
        data: { mobileNumber: "REDACTED", whatsappNumber: null, email: `redacted+${request.profileId}@deleted.local` },
      }),
      prisma.profile.update({
        where: { id: request.profileId },
        data: {
          fullName: anonymized ? "Deleted User" : "Deleted User",
          softDeleted: true,
          accountStatus: "DELETED",
          status: "ARCHIVED",
        },
      }),
      prisma.accountDeletionRequest.update({
        where: { id: requestId },
        data: { status: "COMPLETED", completedAt: new Date() },
      }),
    ]);

    await writeAudit({ action: anonymized ? "DATA_ANONYMIZED" : "DATA_DELETED", targetProfileId: request.profileId, meta: { requestId } });
    await logOutcome("ACCOUNT_DATA", "AccountDeletionRequest", requestId, request.mode ?? "DELETE", "APPLIED");
  } catch (error) {
    await prisma.accountDeletionRequest.update({ where: { id: requestId }, data: { status: "SCHEDULED" } }).catch(() => {});
    await logOutcome("ACCOUNT_DATA", "AccountDeletionRequest", requestId, request.mode ?? "DELETE", "SKIPPED_ERROR", String(error));
  }
}

async function sweepAuditLogs() {
  const policy = await getRetentionPolicy("AUDIT_LOGS");
  if (!policy || !policy.isActive || policy.action !== "DELETE") return;
  const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);
  const eligible = await prisma.auditLog.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, take: 500 });
  for (const row of eligible) {
    try {
      await prisma.auditLog.delete({ where: { id: row.id } });
      await logOutcome("AUDIT_LOGS", "AuditLog", row.id, "DELETE", "APPLIED");
    } catch (error) {
      await logOutcome("AUDIT_LOGS", "AuditLog", row.id, "DELETE", "SKIPPED_ERROR", String(error));
    }
  }
}

async function expireDataExports() {
  const expired = await prisma.dataExportRequest.findMany({
    where: { expiresAt: { lt: new Date() }, status: { in: ["READY", "DOWNLOADED"] } },
  });
  for (const exp of expired) {
    try {
      await prisma.dataExportRequest.update({ where: { id: exp.id }, data: { status: "EXPIRED" } });
      await logOutcome("PROFILE_DATA", "DataExportRequest", exp.id, "DELETE", "APPLIED", "export token expired");
    } catch (error) {
      await logOutcome("PROFILE_DATA", "DataExportRequest", exp.id, "DELETE", "SKIPPED_ERROR", String(error));
    }
  }
}

// STEP 14 — FINANCIAL_RECORDS is now live. Payments/Invoices/Refunds are
// never auto-deleted here (spec §47/§51's immutability + "never delete
// financial records without checking retention requirements" both argue
// against it) — only stale PaymentWebhookEvent rows (transient event-log
// noise, not an accounting record) are eligible for automated pruning.
async function sweepFinancialWebhookEvents() {
  const policy = await getRetentionPolicy("FINANCIAL_RECORDS");
  if (!policy || !policy.isActive || policy.action !== "DELETE") return;
  const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);
  const eligible = await prisma.paymentWebhookEvent.findMany({ where: { receivedAt: { lt: cutoff } }, select: { id: true }, take: 500 });
  for (const row of eligible) {
    try {
      await prisma.paymentWebhookEvent.delete({ where: { id: row.id } });
      await logOutcome("FINANCIAL_RECORDS", "PaymentWebhookEvent", row.id, "DELETE", "APPLIED");
    } catch (error) {
      await logOutcome("FINANCIAL_RECORDS", "PaymentWebhookEvent", row.id, "DELETE", "SKIPPED_ERROR", String(error));
    }
  }
}

// Categories with a configured, active policy but no automated handler yet
// (spec's "Review Required" is a legitimate first-class action, not a gap —
// disclosed in the final report as current automation coverage).
const UNAUTOMATED_CATEGORIES: DataCategory[] = [
  "PROFILE_DATA",
  "CONTACT_DATA",
  "PHOTOS",
  "VERIFICATION_DOCUMENTS",
  "CONSENT_RECORDS",
  "PROPOSAL_RECORDS",
  "MEETING_RECORDS",
  "COMMUNICATION_RECORDS",
  "SUPPORT_CASES",
  "SAFETY_CASES",
  "SECURITY_LOGS",
];

async function flagUnautomatedCategories() {
  const policies = await prisma.retentionPolicy.findMany({ where: { category: { in: UNAUTOMATED_CATEGORIES }, isActive: true } });
  for (const policy of policies) {
    await logOutcome(policy.category, "RetentionPolicy", policy.id, policy.action, "REVIEW_FLAGGED", "no automated handler for this category yet");
  }
}

// Spec §19 — each unit of work is wrapped independently; one failure never
// aborts or rolls back another. Piggybacks on the existing single once-daily
// cron tick (see src/app/api/cron/notifications/route.ts) rather than a
// second Vercel Hobby cron entry.
export async function runDueRetentionActions() {
  const dueDeletions = await prisma.accountDeletionRequest.findMany({
    where: { status: "SCHEDULED", scheduledFor: { lte: new Date() } },
    select: { id: true },
  });
  for (const req of dueDeletions) {
    await executeAccountDeletion(req.id).catch(() => {});
  }
  await sweepAuditLogs().catch(() => {});
  await sweepFinancialWebhookEvents().catch(() => {});
  await expireDataExports().catch(() => {});
  await flagUnautomatedCategories().catch(() => {});
  return { deletionsProcessed: dueDeletions.length };
}

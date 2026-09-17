import { prisma } from "@/lib/prisma";
import type { ReportFilters } from "@/lib/reports/types";

// Spec §47 — a dedicated Privacy report tab, mirroring STEP 12's
// computeCasesReport() precedent exactly, for the same reason: privacy data
// needs row-scoping/sensitivity rules the generic Custom Report Builder
// doesn't model for any existing source. Counts and durations only — never
// row-level identity (consenting profile, requester, etc.).
export async function computePrivacyReport(filters: ReportFilters) {
  const { from, to } = filters.dateRange;
  const where = { recordedAt: { gte: from, lte: to } };
  const requestWhere = { submittedAt: { gte: from, lte: to } };

  const [
    consentGrants,
    consentRevocations,
    privacyRequestsByType,
    deletionRequestsByStatus,
    retentionActionsByOutcome,
    activeHolds,
    sensitiveAccessCount,
    contactSharingEvents,
    incidentsByCategory,
    exportsByStatus,
  ] = await Promise.all([
    prisma.consentGrant.count({ where: { ...where, status: "GRANTED" } }),
    prisma.consentGrant.count({ where: { ...where, status: "REVOKED" } }),
    prisma.privacyRequest.groupBy({ by: ["type"], where: requestWhere, _count: { type: true } }),
    prisma.accountDeletionRequest.groupBy({ by: ["status"], where: requestWhere, _count: { status: true } }),
    prisma.retentionActionLog.groupBy({ by: ["outcome"], where: { runAt: { gte: from, lte: to } }, _count: { outcome: true } }),
    prisma.dataHold.count({ where: { active: true } }),
    prisma.privacyAccessLog.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.auditLog.count({ where: { action: { in: ["CONTACT_SHARED", "CONTACT_SHARE_REVOKED"] }, createdAt: { gte: from, lte: to } } }),
    prisma.case.groupBy({ by: ["category"], where: { type: "PRIVACY_INCIDENT", createdAt: { gte: from, lte: to } }, _count: { category: true } }),
    prisma.dataExportRequest.groupBy({ by: ["status"], where: { requestedAt: { gte: from, lte: to } }, _count: { status: true } }),
  ]);

  return {
    consentGrants,
    consentRevocations,
    privacyRequestsByType: privacyRequestsByType.map((r) => ({ label: r.type, count: r._count.type })),
    deletionRequestsByStatus: deletionRequestsByStatus.map((r) => ({ label: r.status, count: r._count.status })),
    retentionActionsByOutcome: retentionActionsByOutcome.map((r) => ({ label: r.outcome, count: r._count.outcome })),
    activeHolds,
    sensitiveAccessCount,
    contactSharingEvents,
    incidentsByCategory: incidentsByCategory.map((r) => ({ label: r.category, count: r._count.category })),
    exportsByStatus: exportsByStatus.map((r) => ({ label: r.status, count: r._count.status })),
  };
}

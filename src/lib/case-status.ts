import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { notifyCaseStatusChanged } from "@/lib/notifications/events";
import type { CaseStatus } from "@prisma/client";

// Shared by every route that transitions a case's status, so the
// CaseStatusHistory row, audit entry, and user-facing notification can never
// drift out of sync with each other.
export async function changeCaseStatus(params: { caseId: string; toStatus: CaseStatus; adminId: string; reason?: string; notifyUser?: boolean }) {
  const caseRecord = await prisma.case.findUnique({ where: { id: params.caseId }, select: { status: true, reporterProfileId: true } });
  if (!caseRecord) return null;

  const updated = await prisma.$transaction([
    prisma.case.update({ where: { id: params.caseId }, data: { status: params.toStatus } }),
    prisma.caseStatusHistory.create({
      data: { caseId: params.caseId, fromStatus: caseRecord.status, toStatus: params.toStatus, changedById: params.adminId, reason: params.reason ?? null },
    }),
  ]);

  await writeAudit({ action: "CASE_STATUS_CHANGED", adminId: params.adminId, meta: { caseId: params.caseId, fromStatus: caseRecord.status, toStatus: params.toStatus, reason: params.reason } });

  if (params.notifyUser !== false) {
    await notifyCaseStatusChanged(caseRecord.reporterProfileId);
  }

  return updated[0];
}

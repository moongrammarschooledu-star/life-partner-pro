import { prisma } from "@/lib/prisma";
import type { CaseCategory } from "@prisma/client";

const DUPLICATE_WINDOW_DAYS = 30;
const NON_CLOSED_STATUSES = ["NEW", "ACKNOWLEDGED", "ASSIGNED", "IN_REVIEW", "WAITING_FOR_USER", "WAITING_FOR_STAFF", "ESCALATED", "ACTION_REQUIRED", "REOPENED"] as const;

// Spec §26 — a real heuristic query (same reporter + same reported party +
// same category within a recent window), not fuzzy text matching. Returns
// candidates for the UI to show as "Possible Existing Case"; never blocks or
// discards the new submission itself.
export async function findPossibleDuplicateCases(params: {
  reporterProfileId?: string | null;
  reportedProfileId?: string | null;
  reportedAdminId?: string | null;
  category: CaseCategory;
}) {
  if (!params.reporterProfileId) return [];

  const since = new Date(Date.now() - DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  return prisma.case.findMany({
    where: {
      reporterProfileId: params.reporterProfileId,
      category: params.category,
      status: { in: [...NON_CLOSED_STATUSES] },
      createdAt: { gte: since },
      ...(params.reportedProfileId ? { reportedProfileId: params.reportedProfileId } : {}),
      ...(params.reportedAdminId ? { reportedAdminId: params.reportedAdminId } : {}),
    },
    select: { id: true, caseNumber: true, subject: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
}

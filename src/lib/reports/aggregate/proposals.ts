import { prisma } from "@/lib/prisma";
import { buildProposalWhere } from "@/lib/reports/where-builders";
import { sumProposalStatuses } from "@/lib/reports/proposal-status";
import { safeRate } from "@/lib/reports/sample-size";
import { bucketByDay } from "@/lib/reports/day-bucketing";
import type { ReportFilters } from "@/lib/reports/types";

// Spec §14 — status-bucket counts (via the shared, dashboard-agreeing
// groupings) + conversion-funnel rates, each null (not a misleading %) below
// MIN_SAMPLE_SIZE.
export async function computeProposalAnalytics(filters: ReportFilters) {
  const where = buildProposalWhere(filters);
  const [grouped, rows, respondedCount, mutualInterestDistinct] = await Promise.all([
    prisma.proposal.groupBy({ by: ["status"], where, _count: { status: true } }),
    prisma.proposal.findMany({ where, select: { createdAt: true } }),
    prisma.proposalResponse.count({ where: { proposal: { is: where } } }),
    prisma.proposal.count({ where: { ...where, status: { in: ["BOTH_INTERESTED"] } } }),
  ]);

  const countByStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count.status]));
  const total = grouped.reduce((sum, g) => sum + g._count.status, 0);

  const pendingResponses = sumProposalStatuses(countByStatus, "pendingResponses");
  const mutualInterest = sumProposalStatuses(countByStatus, "mutualInterest");
  const accepted = sumProposalStatuses(countByStatus, "accepted");
  const finalized = sumProposalStatuses(countByStatus, "finalized");
  const married = sumProposalStatuses(countByStatus, "married");
  const rejected = sumProposalStatuses(countByStatus, "rejected");
  const contactPending = sumProposalStatuses(countByStatus, "contactPending");
  const onHold = sumProposalStatuses(countByStatus, "onHold");

  const meetingsCount = await prisma.meeting.count({ where: { proposal: { is: where } } });

  return {
    total,
    byStatus: { pendingResponses, mutualInterest, contactPending, accepted, finalized, married, rejected, onHold },
    trend: bucketByDay(rows, (r) => r.createdAt),
    rates: {
      interestRate: safeRate(respondedCount, total),
      mutualInterestRate: safeRate(mutualInterestDistinct, total),
      meetingRate: safeRate(meetingsCount, total),
      acceptanceRate: safeRate(accepted, total),
      finalizationRate: safeRate(finalized, total),
    },
  };
}

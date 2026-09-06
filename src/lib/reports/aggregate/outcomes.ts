import { prisma } from "@/lib/prisma";
import { buildProposalWhere } from "@/lib/reports/where-builders";
import { sumProposalStatuses } from "@/lib/reports/proposal-status";
import { bucketByDayMultiSeries } from "@/lib/reports/day-bucketing";
import type { ReportFilters } from "@/lib/reports/types";

// Spec §16 — outcome counts + monthly trend (bucketed by day here; the UI
// aggregates up to month/year buckets for display, same underlying data).
export async function computeOutcomeAnalytics(filters: ReportFilters) {
  const where = buildProposalWhere(filters);
  const [grouped, rows] = await Promise.all([
    prisma.proposal.groupBy({ by: ["status"], where, _count: { status: true } }),
    prisma.proposal.findMany({ where, select: { createdAt: true, status: true } }),
  ]);

  const countByStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count.status]));

  const outcomeGroupFor = (status: string): string | null => {
    if (["ACCEPTED"].includes(status)) return "accepted";
    if (["FINALIZED"].includes(status)) return "finalized";
    if (["MARRIED"].includes(status)) return "married";
    if (["REJECTED", "NOT_INTERESTED"].includes(status)) return "rejected";
    if (["ON_HOLD"].includes(status)) return "onHold";
    if (["CLOSED"].includes(status)) return "closed";
    if (["ARCHIVED"].includes(status)) return "archived";
    return null;
  };

  return {
    counts: {
      accepted: sumProposalStatuses(countByStatus, "accepted"),
      finalized: sumProposalStatuses(countByStatus, "finalized"),
      married: sumProposalStatuses(countByStatus, "married"),
      rejected: sumProposalStatuses(countByStatus, "rejected"),
      onHold: sumProposalStatuses(countByStatus, "onHold"),
      closed: sumProposalStatuses(countByStatus, "closed"),
      archived: sumProposalStatuses(countByStatus, "archived"),
    },
    trend: bucketByDayMultiSeries(
      rows.filter((r) => outcomeGroupFor(r.status)),
      (r) => r.createdAt,
      (r) => outcomeGroupFor(r.status)!
    ),
  };
}

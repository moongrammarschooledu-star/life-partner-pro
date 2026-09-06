import { prisma } from "@/lib/prisma";
import { buildProfileWhere, buildProposalWhere, buildMatchWhere } from "@/lib/reports/where-builders";
import { buildKpiResult } from "@/lib/reports/kpi";
import { sumProposalStatuses } from "@/lib/reports/proposal-status";
import { bucketByDay } from "@/lib/reports/day-bucketing";
import type { ReportFilters } from "@/lib/reports/types";

function shiftedFilters(filters: ReportFilters): ReportFilters {
  return { ...filters, dateRange: { ...filters.dateRange, from: filters.dateRange.previousFrom, to: filters.dateRange.previousTo } };
}

async function countsFor(filters: ReportFilters) {
  const profileWhere = buildProfileWhere(filters);
  const proposalWhere = buildProposalWhere(filters);
  const matchWhere = buildMatchWhere(filters);

  const [total, newCount, verified, active, underReview, totalMatches, highCompatMatches, proposalStatusCounts] = await Promise.all([
    prisma.profile.count({ where: { ...profileWhere, createdAt: undefined } }),
    prisma.profile.count({ where: profileWhere }),
    prisma.profile.count({ where: { ...profileWhere, createdAt: undefined, verified: true } }),
    prisma.profile.count({ where: { ...profileWhere, createdAt: undefined, status: "ACTIVE" } }),
    prisma.profile.count({ where: { ...profileWhere, createdAt: undefined, status: "UNDER_REVIEW" } }),
    prisma.match.count({ where: matchWhere }),
    prisma.match.count({ where: { ...matchWhere, score: { gte: 80 } } }),
    prisma.proposal.groupBy({ by: ["status"], where: proposalWhere, _count: { status: true } }),
  ]);

  const countByStatus = Object.fromEntries(proposalStatusCounts.map((g) => [g.status, g._count.status]));
  const totalProposals = proposalStatusCounts.reduce((sum, g) => sum + g._count.status, 0);

  return {
    total,
    newCount,
    verified,
    active,
    underReview,
    totalMatches,
    highCompatMatches,
    totalProposals,
    mutualInterest: sumProposalStatuses(countByStatus, "mutualInterest"),
    accepted: sumProposalStatuses(countByStatus, "accepted"),
    finalized: sumProposalStatuses(countByStatus, "finalized"),
    married: sumProposalStatuses(countByStatus, "married"),
    rejected: sumProposalStatuses(countByStatus, "rejected"),
  };
}

// Spec §2 — every KPI card with current value, previous-period comparison,
// %-change, and trend. "Total"/"Verified"/"Active"/"Under Review" are
// point-in-time snapshots (not scoped to the date range, since "how many
// verified profiles exist right now" is the meaningful reading); "New
// Profiles", matches, and proposal-family counts ARE scoped to the active
// date range on both sides of the comparison.
export async function computeOverview(filters: ReportFilters) {
  const [current, previous] = await Promise.all([countsFor(filters), countsFor(shiftedFilters(filters))]);

  const [meetingsScheduled, meetingsScheduledPrevious] = await Promise.all([
    prisma.meeting.count({ where: { status: { in: ["SCHEDULED", "CONFIRMED"] }, proposal: { is: buildProposalWhere(filters) } } }),
    prisma.meeting.count({ where: { status: { in: ["SCHEDULED", "CONFIRMED"] }, proposal: { is: buildProposalWhere(shiftedFilters(filters)) } } }),
  ]);

  const registrationRows = await prisma.profile.findMany({ where: buildProfileWhere(filters), select: { createdAt: true } });

  return {
    kpis: {
      totalProfiles: buildKpiResult(current.total, previous.total),
      newProfiles: buildKpiResult(current.newCount, previous.newCount),
      verifiedProfiles: buildKpiResult(current.verified, previous.verified),
      activeProfiles: buildKpiResult(current.active, previous.active),
      underReviewProfiles: buildKpiResult(current.underReview, previous.underReview),
      totalMatches: buildKpiResult(current.totalMatches, previous.totalMatches),
      highCompatMatches: buildKpiResult(current.highCompatMatches, previous.highCompatMatches),
      totalProposals: buildKpiResult(current.totalProposals, previous.totalProposals),
      mutualInterest: buildKpiResult(current.mutualInterest, previous.mutualInterest),
      meetingsScheduled: buildKpiResult(meetingsScheduled, meetingsScheduledPrevious),
      accepted: buildKpiResult(current.accepted, previous.accepted),
      finalized: buildKpiResult(current.finalized, previous.finalized),
      married: buildKpiResult(current.married, previous.married),
      rejected: buildKpiResult(current.rejected, previous.rejected),
    },
    registrationTrend: bucketByDay(registrationRows, (r) => r.createdAt),
  };
}

import { prisma } from "@/lib/prisma";
import { buildProfileWhere, buildProposalWhere } from "@/lib/reports/where-builders";
import { sumProposalStatuses } from "@/lib/reports/proposal-status";
import type { ReportFilters } from "@/lib/reports/types";

// Spec §17 — the 10-stage success funnel. Each stage count is the number of
// PROFILES (not proposals) that have reached at least that milestone, except
// Proposals/Mutual Interest/Meetings/Accepted/Finalized/Married, which are
// proposal-level per spec's own funnel shape (a profile can appear in
// multiple proposals). `href` lets the UI wire each stage to a pre-filtered
// list page (spec §17/§26).
export async function computeFunnelAnalytics(filters: ReportFilters) {
  const profileWhere = buildProfileWhere(filters);
  const proposalWhere = buildProposalWhere(filters);

  const [registered, verified, active, suitableMatches, proposalStatusCounts, meetingsCount] = await Promise.all([
    prisma.profile.count({ where: profileWhere }),
    prisma.profile.count({ where: { ...profileWhere, verified: true } }),
    prisma.profile.count({ where: { ...profileWhere, status: "ACTIVE" } }),
    prisma.match.count({ where: { score: { gte: 60 }, status: { not: "REJECTED" } } }),
    prisma.proposal.groupBy({ by: ["status"], where: proposalWhere, _count: { status: true } }),
    prisma.meeting.count({ where: { proposal: { is: proposalWhere } } }),
  ]);

  const countByStatus = Object.fromEntries(proposalStatusCounts.map((g) => [g.status, g._count.status]));
  const totalProposals = proposalStatusCounts.reduce((sum, g) => sum + g._count.status, 0);

  return {
    stages: [
      { key: "registered", label: "Registered Profiles", count: registered, href: "/admin/profiles" },
      { key: "verified", label: "Verified Profiles", count: verified, href: "/admin/profiles?verified=true" },
      { key: "active", label: "Active Profiles", count: active, href: "/admin/profiles?status=ACTIVE" },
      { key: "suitableMatches", label: "Suitable Matches", count: suitableMatches, href: "/admin/matches" },
      { key: "proposals", label: "Proposals", count: totalProposals, href: "/admin/proposals" },
      { key: "mutualInterest", label: "Mutual Interest", count: sumProposalStatuses(countByStatus, "mutualInterest"), href: "/admin/proposals?statusGroup=mutual_interest" },
      { key: "meetings", label: "Meetings", count: meetingsCount, href: "/admin/meetings" },
      { key: "accepted", label: "Accepted", count: sumProposalStatuses(countByStatus, "accepted"), href: "/admin/proposals?statusGroup=outcome" },
      { key: "finalized", label: "Finalized", count: sumProposalStatuses(countByStatus, "finalized"), href: "/admin/proposals?statusGroup=outcome" },
      { key: "married", label: "Married", count: sumProposalStatuses(countByStatus, "married"), href: "/admin/proposals?statusGroup=outcome" },
    ],
  };
}

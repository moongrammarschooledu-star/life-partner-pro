import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

export async function GET() {
  try {
    await requireAdmin("audit:view");

    const [totalProfiles, finalizedOrMarried, notesByAdmin, communicationsByAdmin, admins, incomeBuckets, matches, proposalStatusCounts] =
      await Promise.all([
        prisma.profile.count({ where: { softDeleted: false } }),
        prisma.profile.count({ where: { status: { in: ["FINALIZED", "MARRIED"] }, softDeleted: false } }),
        prisma.profileNote.groupBy({ by: ["adminId"], _count: { adminId: true } }),
        prisma.communication.groupBy({ by: ["adminId"], _count: { adminId: true } }),
        prisma.adminUser.findMany({ select: { id: true, name: true } }),
        prisma.professionInfo.findMany({ select: { monthlyIncome: true } }),
        prisma.match.findMany({ select: { score: true, status: true } }),
        prisma.proposal.groupBy({ by: ["status"], _count: { status: true } }),
      ]);

    const performance = admins.map((a) => ({
      name: a.name,
      notes: notesByAdmin.find((n) => n.adminId === a.id)?._count.adminId ?? 0,
      communications: communicationsByAdmin.find((c) => c.adminId === a.id)?._count.adminId ?? 0,
    }));

    const buckets: Record<string, number> = { "< $1000": 0, "$1000-2000": 0, "$2000-3500": 0, "$3500-5000": 0, "$5000+": 0, "Not disclosed": 0 };
    for (const p of incomeBuckets) {
      const income = p.monthlyIncome;
      if (income == null) buckets["Not disclosed"]++;
      else if (income < 1000) buckets["< $1000"]++;
      else if (income < 2000) buckets["$1000-2000"]++;
      else if (income < 3500) buckets["$2000-3500"]++;
      else if (income < 5000) buckets["$3500-5000"]++;
      else buckets["$5000+"]++;
    }

    // Matching performance (spec §37) — a score never predicts marriage
    // success; these are activity/conversion metrics only, framed that way
    // in the UI. Funnel rates use each proposal's *current* status as a
    // snapshot (not a full historical-transition audit), which is a
    // reasonable approximation without adding event-sourcing infrastructure.
    const matchesGenerated = matches.length;
    const averageMatchScore = matchesGenerated > 0 ? Math.round(matches.reduce((sum, m) => sum + m.score, 0) / matchesGenerated) : 0;
    const matchesReviewed = matches.filter((m) => m.status !== "SUGGESTED").length;
    const matchesToProposal = matches.filter((m) => m.status === "PROPOSAL_CREATED").length;

    const proposalCountByStatus = Object.fromEntries(proposalStatusCounts.map((p) => [p.status, p._count.status]));
    const totalProposals = proposalStatusCounts.reduce((sum, p) => sum + p._count.status, 0);
    const proposalsAtMeetingOrBeyond = (proposalCountByStatus.MEETING ?? 0) + (proposalCountByStatus.FINALIZED ?? 0);
    const finalizedProposals = proposalCountByStatus.FINALIZED ?? 0;

    return NextResponse.json({
      conversionRate: totalProfiles > 0 ? Math.round((finalizedOrMarried / totalProfiles) * 100) : 0,
      totalProfiles,
      finalizedOrMarried,
      adminPerformance: performance.filter((p) => p.notes > 0 || p.communications > 0),
      incomeDistribution: Object.entries(buckets).map(([label, count]) => ({ label, count })),
      matchingPerformance: {
        averageMatchScore,
        matchesGenerated,
        matchesReviewed,
        proposalsCreated: matchesToProposal,
        finalizedMatches: finalizedProposals,
        matchToProposalRate: matchesGenerated > 0 ? Math.round((matchesToProposal / matchesGenerated) * 100) : 0,
        proposalToMeetingRate: totalProposals > 0 ? Math.round((proposalsAtMeetingOrBeyond / totalProposals) * 100) : 0,
        meetingToFinalizationRate: proposalsAtMeetingOrBeyond > 0 ? Math.round((finalizedProposals / proposalsAtMeetingOrBeyond) * 100) : 0,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

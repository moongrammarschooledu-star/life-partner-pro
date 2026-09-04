import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { subMonths, startOfMonth, format } from "date-fns";

export async function GET() {
  try {
    await requireAdmin("audit:view");

    const [
      totalProfiles,
      finalizedOrMarried,
      notesByAdmin,
      communicationsByAdmin,
      admins,
      incomeBuckets,
      matches,
      proposalStatusCounts,
      allProposals,
      proposalsWithMeeting,
      mutualInterestEvents,
    ] = await Promise.all([
      prisma.profile.count({ where: { softDeleted: false } }),
      prisma.profile.count({ where: { status: { in: ["FINALIZED", "MARRIED"] }, softDeleted: false } }),
      prisma.profileNote.groupBy({ by: ["adminId"], _count: { adminId: true } }),
      prisma.communication.groupBy({ by: ["adminId"], _count: { adminId: true } }),
      prisma.adminUser.findMany({ select: { id: true, name: true } }),
      prisma.professionInfo.findMany({ select: { monthlyIncome: true } }),
      prisma.match.findMany({ select: { score: true, status: true } }),
      prisma.proposal.groupBy({ by: ["status"], _count: { status: true } }),
      prisma.proposal.findMany({ select: { createdAt: true } }),
      prisma.proposal.count({ where: { meetings: { some: {} } } }),
      prisma.proposalEvent.findMany({ where: { status: "BOTH_INTERESTED" }, distinct: ["proposalId"], select: { proposalId: true } }),
    ]);

    // "Ever reached FINALIZED" via event history, not current status — a
    // proposal that progressed FINALIZED -> MARRIED no longer shows
    // FINALIZED as its *current* status, which would otherwise undercount
    // finalization (every married proposal was finalized first).
    const everFinalizedEvents = await prisma.proposalEvent.findMany({
      where: { status: { in: ["FINALIZED", "MARRIED"] } },
      distinct: ["proposalId"],
      select: { proposalId: true },
    });

    const proposalsWithAnyInterest = await prisma.proposal.count({ where: { responses: { some: { response: "INTERESTED" } } } });

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

    const proposalCountByStatus: Record<string, number> = Object.fromEntries(proposalStatusCounts.map((p) => [p.status, p._count.status]));
    const totalProposals = proposalStatusCounts.reduce((sum, p) => sum + p._count.status, 0);
    const marriedProposals = proposalCountByStatus.MARRIED ?? 0;
    // Kept for the older matchToProposalRate/proposalToMeetingRate fields below.
    const proposalsAtMeetingOrBeyond = proposalsWithMeeting;

    const proposalsByMonth: { month: string; count: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const monthStart = startOfMonth(subMonths(now, i));
      const nextMonthStart = startOfMonth(subMonths(now, i - 1));
      proposalsByMonth.push({
        month: format(monthStart, "MMM yyyy"),
        count: allProposals.filter((p) => p.createdAt >= monthStart && p.createdAt < nextMonthStart).length,
      });
    }

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
        finalizedMatches: everFinalizedEvents.length,
        matchToProposalRate: matchesGenerated > 0 ? Math.round((matchesToProposal / matchesGenerated) * 100) : 0,
        proposalToMeetingRate: totalProposals > 0 ? Math.round((proposalsAtMeetingOrBeyond / totalProposals) * 100) : 0,
        meetingToFinalizationRate: proposalsAtMeetingOrBeyond > 0 ? Math.round((everFinalizedEvents.length / proposalsAtMeetingOrBeyond) * 100) : 0,
      },
      proposalPerformance: {
        proposalsByMonth,
        interestRate: totalProposals > 0 ? Math.round((proposalsWithAnyInterest / totalProposals) * 100) : 0,
        mutualInterestRate: totalProposals > 0 ? Math.round((mutualInterestEvents.length / totalProposals) * 100) : 0,
        meetingConversionRate: totalProposals > 0 ? Math.round((proposalsWithMeeting / totalProposals) * 100) : 0,
        finalizationRate: totalProposals > 0 ? Math.round((everFinalizedEvents.length / totalProposals) * 100) : 0,
        marriageOutcomeRate: totalProposals > 0 ? Math.round((marriedProposals / totalProposals) * 100) : 0,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

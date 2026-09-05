import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { ensureAllProfileVerifications } from "@/lib/verification/status";
import { subMonths, subDays, subWeeks, startOfMonth, startOfDay, endOfDay, format } from "date-fns";

// Percentage change is only ever computed from a real, immutable event count
// (registrations by createdAt, or a specific AuditLog action) comparing this
// week to the prior week — never fabricated. Metrics with no clean
// event-based basis (point-in-time snapshots like "currently Active") are
// returned as a plain count with `trendPercent: null`, and the UI shows no
// arrow rather than a misleading number.
function trendPercent(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

const PERIOD_DAYS: Record<string, number> = {
  today: 1,
  "7d": 7,
  "30d": 30,
  "3m": 90,
  "6m": 182,
  "1y": 365,
};

export async function GET(req: Request) {
  try {
    await requireAdmin("profile:view");
    await ensureAllProfileVerifications();
    const { searchParams } = new URL(req.url);
    const period = searchParams.get("period") ?? "6m";
    const days = PERIOD_DAYS[period] ?? 182;

    const now = new Date();
    const weekAgo = subWeeks(now, 1);
    const twoWeeksAgo = subWeeks(now, 2);

    const [
      total,
      newCount,
      verified,
      active,
      pendingReview,
      male,
      female,
      byCityRaw,
      byEducationRaw,
      byProfessionRaw,
      profiles,
      registrationsThisWeek,
      registrationsLastWeek,
      verifiedEventsThisWeek,
      verifiedEventsLastWeek,
      proposalStats,
      matchCounts,
      profilesAwaitingVerification,
      followUpsDueToday,
      newHighCompatMatches,
      recentProposalResponses,
      periodProfiles,
    ] = await Promise.all([
      prisma.profile.count({ where: { softDeleted: false } }),
      prisma.profile.count({ where: { status: "NEW", softDeleted: false } }),
      prisma.profile.count({ where: { verified: true, softDeleted: false } }),
      prisma.profile.count({ where: { status: "ACTIVE", softDeleted: false } }),
      prisma.profile.count({ where: { status: "UNDER_REVIEW", softDeleted: false } }),
      prisma.profile.count({ where: { gender: "MALE", softDeleted: false } }),
      prisma.profile.count({ where: { gender: "FEMALE", softDeleted: false } }),
      prisma.profile.groupBy({ by: ["city"], _count: { city: true }, where: { softDeleted: false }, orderBy: { _count: { city: "desc" } }, take: 8 }),
      prisma.educationInfo.groupBy({ by: ["level"], _count: { level: true }, orderBy: { _count: { level: "desc" } }, take: 8 }),
      prisma.professionInfo.groupBy({ by: ["profession"], _count: { profession: true }, orderBy: { _count: { profession: "desc" } }, take: 8 }),
      prisma.profile.findMany({ where: { softDeleted: false }, select: { dateOfBirth: true, createdAt: true } }),
      prisma.profile.count({ where: { softDeleted: false, createdAt: { gte: weekAgo } } }),
      prisma.profile.count({ where: { softDeleted: false, createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
      prisma.auditLog.count({ where: { action: "PROFILE_VERIFIED", createdAt: { gte: weekAgo } } }),
      prisma.auditLog.count({ where: { action: "PROFILE_VERIFIED", createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
      prisma.proposal.groupBy({ by: ["status"], _count: { status: true } }),
      prisma.match.groupBy({ by: ["status"], _count: { status: true } }),
      prisma.profile.count({ where: { softDeleted: false, verified: false, status: { in: ["NEW", "UNDER_REVIEW"] } } }),
      prisma.followUp.count({ where: { status: "PENDING", dueDate: { gte: startOfDay(now), lte: endOfDay(now) } } }),
      prisma.match.count({ where: { status: "SUGGESTED", createdAt: { gte: subDays(now, 2) }, score: { gte: 80 } } }),
      prisma.proposal.count({ where: { updatedAt: { gte: subDays(now, 1) }, status: { in: ["INTERESTED", "NOT_INTERESTED"] } } }),
      prisma.profile.findMany({
        where: { softDeleted: false, createdAt: { gte: subDays(now, days) } },
        select: { createdAt: true, gender: true },
      }),
    ]);

    const [meetingsScheduledCount, meetingsCompletedCount] = await Promise.all([
      prisma.meeting.count({ where: { status: { in: ["REQUESTED", "SCHEDULED", "CONFIRMED", "RESCHEDULED"] } } }),
      prisma.meeting.count({ where: { status: "COMPLETED" } }),
    ]);

    // Trust & Verification KPIs (STEP 8 §26).
    const [verificationStatusCounts, suspendedCount, potentialDuplicates] = await Promise.all([
      prisma.profileVerification.groupBy({
        by: ["status"],
        _count: { status: true },
        where: { profile: { softDeleted: false } },
      }),
      prisma.profile.count({ where: { status: "SUSPENDED", softDeleted: false } }),
      prisma.securityFlag.count({
        where: { flagType: "DUPLICATE_PROFILE_SUSPECTED", status: { in: ["OPEN", "INVESTIGATING"] }, profile: { softDeleted: false } },
      }),
    ]);
    const verificationCountByStatus = Object.fromEntries(verificationStatusCounts.map((v) => [v.status, v._count.status]));
    const trustKpis = {
      awaitingVerification: verificationCountByStatus.VERIFICATION_PENDING ?? 0,
      verified: verificationCountByStatus.VERIFIED ?? 0,
      verificationRequired: verificationCountByStatus.VERIFICATION_REQUIRED ?? 0,
      rejected: verificationCountByStatus.VERIFICATION_REJECTED ?? 0,
      reVerificationRequired: verificationCountByStatus.RE_VERIFICATION_REQUIRED ?? 0,
      suspended: suspendedCount,
      potentialDuplicates,
    };

    const ageBuckets: Record<string, number> = { "18-24": 0, "25-30": 0, "31-36": 0, "37-45": 0, "46+": 0 };
    for (const p of profiles) {
      const age = now.getFullYear() - p.dateOfBirth.getFullYear();
      if (age <= 24) ageBuckets["18-24"]++;
      else if (age <= 30) ageBuckets["25-30"]++;
      else if (age <= 36) ageBuckets["31-36"]++;
      else if (age <= 45) ageBuckets["37-45"]++;
      else ageBuckets["46+"]++;
    }

    const monthly: { month: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const monthStart = startOfMonth(subMonths(now, i));
      const monthLabel = format(monthStart, "MMM yyyy");
      const nextMonthStart = startOfMonth(subMonths(now, i - 1));
      const count = profiles.filter((p) => p.createdAt >= monthStart && p.createdAt < nextMonthStart).length;
      monthly.push({ month: monthLabel, count });
    }

    // Registration trend: bucket the selected period into up to ~12 buckets,
    // each carrying a separate male/female count, for the two-series chart.
    const bucketCount = period === "today" ? 24 : Math.min(12, days);
    const bucketMs = (days * 24 * 60 * 60 * 1000) / bucketCount;
    const trend: { label: string; male: number; female: number }[] = [];
    for (let i = bucketCount - 1; i >= 0; i--) {
      const bucketEnd = new Date(now.getTime() - i * bucketMs);
      const bucketStart = new Date(bucketEnd.getTime() - bucketMs);
      const inBucket = periodProfiles.filter((p) => p.createdAt >= bucketStart && p.createdAt < bucketEnd);
      trend.push({
        label: period === "today" ? format(bucketEnd, "ha") : format(bucketEnd, days > 60 ? "MMM d" : "MMM d"),
        male: inBucket.filter((p) => p.gender === "MALE").length,
        female: inBucket.filter((p) => p.gender === "FEMALE").length,
      });
    }

    const proposalCountByStatus: Record<string, number> = Object.fromEntries(proposalStats.map((p) => [p.status, p._count.status]));
    const totalProposals = proposalStats.reduce((sum, p) => sum + p._count.status, 0);
    const finalizedProposals = proposalCountByStatus.FINALIZED ?? 0;
    const activeProposals =
      (proposalCountByStatus.SENT ?? 0) + (proposalCountByStatus.WAITING ?? 0) + (proposalCountByStatus.INTERESTED ?? 0);
    const meetingsScheduled = meetingsScheduledCount;

    // STEP 7 proposal KPIs (spec §22) — computed from the new 22-stage
    // lifecycle; legacy (pre-STEP7) statuses are folded in where the
    // meaning clearly corresponds, so old demo rows still count somewhere.
    const sumStatuses = (statuses: string[]) => statuses.reduce((sum, s) => sum + (proposalCountByStatus[s] ?? 0), 0);
    const proposalKpis = {
      total: totalProposals,
      pendingResponses: sumStatuses(["DRAFT", "PROPOSAL_CREATED", "WAITING_FOR_PROFILE_A", "WAITING_FOR_PROFILE_B", "BOTH_REVIEWING", "SENT", "WAITING"]),
      mutualInterest: sumStatuses(["BOTH_INTERESTED", "INTERESTED"]),
      contactPending: sumStatuses(["CONTACT_PERMISSION_PENDING"]),
      meetingsScheduled: meetingsScheduledCount,
      meetingsCompleted: meetingsCompletedCount,
      accepted: sumStatuses(["ACCEPTED"]),
      finalized: sumStatuses(["FINALIZED"]),
      married: sumStatuses(["MARRIED"]),
      rejected: sumStatuses(["REJECTED", "NOT_INTERESTED"]),
    };

    const matchCountByStatus = Object.fromEntries(matchCounts.map((m) => [m.status, m._count.status]));
    const potentialMatches = matchCountByStatus.SUGGESTED ?? 0;
    const highCompatibilityMatches = await prisma.match.count({ where: { score: { gte: 80 }, status: { not: "REJECTED" } } });

    // "Today's Best Matches" (spec §36) — top-scoring matches generated today.
    const todaysBestMatches = await prisma.match.findMany({
      where: { createdAt: { gte: startOfDay(now), lte: endOfDay(now) } },
      include: {
        profileA: { select: { profileCode: true, fullName: true } },
        profileB: { select: { profileCode: true, fullName: true } },
      },
      orderBy: { score: "desc" },
      take: 5,
    });

    return NextResponse.json({
      counts: {
        total,
        new: newCount,
        verified,
        active,
        pendingReview,
        activeProposals,
        meetings: meetingsScheduled,
        successfulMatches: finalizedProposals,
        male,
        female,
      },
      trends: {
        total: trendPercent(registrationsThisWeek, registrationsLastWeek),
        new: trendPercent(registrationsThisWeek, registrationsLastWeek),
        verified: trendPercent(verifiedEventsThisWeek, verifiedEventsLastWeek),
      },
      byCity: byCityRaw.map((c) => ({ label: c.city, count: c._count.city })),
      byEducation: byEducationRaw.map((c) => ({ label: c.level, count: c._count.level })),
      byProfession: byProfessionRaw.map((c) => ({ label: c.profession, count: c._count.profession })),
      byAge: Object.entries(ageBuckets).map(([label, count]) => ({ label, count })),
      byGender: [
        { label: "Male", count: male },
        { label: "Female", count: female },
      ],
      monthlyRegistrations: monthly,
      registrationTrend: trend,
      matchingSuccessRate: totalProposals > 0 ? Math.round((finalizedProposals / totalProposals) * 100) : 0,
      matchingOverview: {
        potentialMatches,
        highCompatibilityMatches,
        proposalsPending: (proposalCountByStatus.DRAFT ?? 0) + (proposalCountByStatus.SENT ?? 0) + (proposalCountByStatus.WAITING ?? 0),
        interested: proposalCountByStatus.INTERESTED ?? 0,
        meetingsScheduled,
        finalized: finalizedProposals,
      },
      priorities: {
        profilesAwaitingVerification,
        followUpsDueToday,
        newHighCompatMatches,
        recentProposalResponses,
      },
      proposalKpis,
      trustKpis,
      verificationByStatus: Object.entries(verificationCountByStatus).map(([label, count]) => ({ label, count: count as number })),
      todaysBestMatches: todaysBestMatches.map((m) => ({
        id: m.id,
        profileACode: m.profileA.profileCode,
        profileAName: m.profileA.fullName,
        profileBCode: m.profileB.profileCode,
        profileBName: m.profileB.fullName,
        score: m.score,
        status: m.status,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

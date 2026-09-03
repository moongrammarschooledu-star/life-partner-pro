import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { subMonths, startOfMonth, format } from "date-fns";

export async function GET() {
  try {
    await requireAdmin("profile:view");

    const [
      total,
      newCount,
      verified,
      male,
      female,
      active,
      matching,
      proposalsSent,
      interested,
      meetings,
      finalized,
      archived,
      byCityRaw,
      byEducationRaw,
      byProfessionRaw,
      profiles,
    ] = await Promise.all([
      prisma.profile.count({ where: { softDeleted: false } }),
      prisma.profile.count({ where: { status: "NEW", softDeleted: false } }),
      prisma.profile.count({ where: { verified: true, softDeleted: false } }),
      prisma.profile.count({ where: { gender: "MALE", softDeleted: false } }),
      prisma.profile.count({ where: { gender: "FEMALE", softDeleted: false } }),
      prisma.profile.count({ where: { status: "ACTIVE", softDeleted: false } }),
      prisma.profile.count({ where: { status: "MATCHING", softDeleted: false } }),
      prisma.profile.count({ where: { status: "PROPOSAL_SENT", softDeleted: false } }),
      prisma.profile.count({ where: { status: "INTERESTED", softDeleted: false } }),
      prisma.profile.count({ where: { status: "MEETING_ARRANGED", softDeleted: false } }),
      prisma.profile.count({ where: { status: "FINALIZED", softDeleted: false } }),
      prisma.profile.count({ where: { status: "ARCHIVED", softDeleted: false } }),
      prisma.profile.groupBy({ by: ["city"], _count: { city: true }, where: { softDeleted: false }, orderBy: { _count: { city: "desc" } }, take: 8 }),
      prisma.educationInfo.groupBy({ by: ["level"], _count: { level: true }, orderBy: { _count: { level: "desc" } }, take: 8 }),
      prisma.professionInfo.groupBy({ by: ["profession"], _count: { profession: true }, orderBy: { _count: { profession: "desc" } }, take: 8 }),
      prisma.profile.findMany({ where: { softDeleted: false }, select: { dateOfBirth: true, createdAt: true } }),
    ]);

    const ageBuckets: Record<string, number> = { "18-24": 0, "25-30": 0, "31-36": 0, "37-45": 0, "46+": 0 };
    const now = new Date();
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

    const proposalStats = await prisma.proposal.groupBy({ by: ["status"], _count: { status: true } });
    const totalProposals = proposalStats.reduce((sum, p) => sum + p._count.status, 0);
    const finalizedProposals = proposalStats.find((p) => p.status === "FINALIZED")?._count.status ?? 0;

    return NextResponse.json({
      counts: { total, new: newCount, verified, male, female, active, matching, proposalsSent, interested, meetings, finalized, archived },
      byCity: byCityRaw.map((c) => ({ label: c.city, count: c._count.city })),
      byEducation: byEducationRaw.map((c) => ({ label: c.level, count: c._count.level })),
      byProfession: byProfessionRaw.map((c) => ({ label: c.profession, count: c._count.profession })),
      byAge: Object.entries(ageBuckets).map(([label, count]) => ({ label, count })),
      monthlyRegistrations: monthly,
      matchingSuccessRate: totalProposals > 0 ? Math.round((finalizedProposals / totalProposals) * 100) : 0,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

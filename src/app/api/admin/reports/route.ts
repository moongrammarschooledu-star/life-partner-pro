import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

export async function GET() {
  try {
    await requireAdmin("audit:view");

    const [totalProfiles, finalizedOrMarried, notesByAdmin, communicationsByAdmin, admins, incomeBuckets] = await Promise.all([
      prisma.profile.count({ where: { softDeleted: false } }),
      prisma.profile.count({ where: { status: { in: ["FINALIZED", "MARRIED"] }, softDeleted: false } }),
      prisma.profileNote.groupBy({ by: ["adminId"], _count: { adminId: true } }),
      prisma.communication.groupBy({ by: ["adminId"], _count: { adminId: true } }),
      prisma.adminUser.findMany({ select: { id: true, name: true } }),
      prisma.professionInfo.findMany({ select: { monthlyIncome: true } }),
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

    return NextResponse.json({
      conversionRate: totalProfiles > 0 ? Math.round((finalizedOrMarried / totalProfiles) * 100) : 0,
      totalProfiles,
      finalizedOrMarried,
      adminPerformance: performance.filter((p) => p.notes > 0 || p.communications > 0),
      incomeDistribution: Object.entries(buckets).map(([label, count]) => ({ label, count })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

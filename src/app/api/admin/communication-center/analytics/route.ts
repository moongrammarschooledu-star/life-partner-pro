import { NextResponse } from "next/server";
import { subDays, format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

// Spec §29 — totals, delivery/failure rate, volume over time, all excluding
// isTest rows so test-mode sends never pollute real analytics.
export async function GET(req: Request) {
  try {
    await requireAdmin("communication:view");
    const { searchParams } = new URL(req.url);
    const days = Math.min(Number(searchParams.get("days") ?? 30), 365);
    const since = subDays(new Date(), days);

    const [total, byChannel, byStatus, recent] = await Promise.all([
      prisma.communicationLog.count({ where: { isTest: false, createdAt: { gte: since } } }),
      prisma.communicationLog.groupBy({ by: ["channel"], _count: { channel: true }, where: { isTest: false, createdAt: { gte: since } } }),
      prisma.communicationLog.groupBy({ by: ["deliveryStatus"], _count: { deliveryStatus: true }, where: { isTest: false, createdAt: { gte: since } } }),
      prisma.communicationLog.findMany({
        where: { isTest: false, createdAt: { gte: since } },
        select: { createdAt: true, channel: true },
      }),
    ]);

    const countByChannel = Object.fromEntries(byChannel.map((c) => [c.channel, c._count.channel]));
    const countByStatus = Object.fromEntries(byStatus.map((s) => [s.deliveryStatus, s._count.deliveryStatus]));

    const sent = (countByStatus.SENT ?? 0) + (countByStatus.DELIVERED ?? 0) + (countByStatus.READ ?? 0);
    const failed = countByStatus.FAILED ?? 0;
    const attempted = sent + failed;

    const volumeByDay = new Map<string, number>();
    for (const row of recent) {
      const day = format(row.createdAt, "yyyy-MM-dd");
      volumeByDay.set(day, (volumeByDay.get(day) ?? 0) + 1);
    }

    return NextResponse.json({
      total,
      byChannel: countByChannel,
      byStatus: countByStatus,
      deliveryRate: attempted > 0 ? Math.round((sent / attempted) * 100) : null,
      failureRate: attempted > 0 ? Math.round((failed / attempted) * 100) : null,
      volumeByDay: Array.from(volumeByDay.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => a.label.localeCompare(b.label)),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

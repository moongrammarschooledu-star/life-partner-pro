import { prisma } from "@/lib/prisma";
import { buildCommunicationWhere } from "@/lib/reports/where-builders";
import { bucketByDay } from "@/lib/reports/day-bucketing";
import { safeRate } from "@/lib/reports/sample-size";
import type { ReportFilters } from "@/lib/reports/types";

// Spec §20 — surfaces STEP 9's CommunicationLog data inside the main
// Reports surface for the first time (previously only visible in the
// separate Communication Center). Never exposes messageBody — counts only.
export async function computeCommunicationAnalytics(filters: ReportFilters) {
  const where = buildCommunicationWhere(filters);
  const [byChannel, byStatus, recent] = await Promise.all([
    prisma.communicationLog.groupBy({ by: ["channel"], where, _count: { channel: true } }),
    prisma.communicationLog.groupBy({ by: ["deliveryStatus"], where, _count: { deliveryStatus: true } }),
    prisma.communicationLog.findMany({ where, select: { createdAt: true } }),
  ]);

  const countByChannel = Object.fromEntries(byChannel.map((c) => [c.channel, c._count.channel]));
  const countByStatus = Object.fromEntries(byStatus.map((s) => [s.deliveryStatus, s._count.deliveryStatus]));
  const sent = (countByStatus.SENT ?? 0) + (countByStatus.DELIVERED ?? 0) + (countByStatus.READ ?? 0);
  const failed = countByStatus.FAILED ?? 0;

  return {
    total: recent.length,
    byChannel: countByChannel,
    byStatus: countByStatus,
    deliveryRate: safeRate(sent, sent + failed),
    failureRate: safeRate(failed, sent + failed),
    volumeByDay: bucketByDay(recent, (r) => r.createdAt),
  };
}

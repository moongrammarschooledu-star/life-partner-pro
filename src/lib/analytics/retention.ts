import { prisma } from "@/lib/prisma";

// STEP 31 - retention for analytics. The data marts, forecasts and reconciliation rows are DERIVED (rebuildable from source) and carry
// no personal data, so they are not subject to a retention clock. The one thing that records people is the access log (who looked at
// what, never the data), swept only under an admin-created ANALYTICS_ACCESS_DATA policy: with no policy nothing is deleted
// (absent policy = keep). Report deliveries follow the same window.

export async function sweepAnalyticsRetention(now: Date = new Date()): Promise<{ accessLogsDeleted: number; deliveriesDeleted: number }> {
  const policy = await prisma.retentionPolicy.findUnique({ where: { category: "ANALYTICS_ACCESS_DATA" } });
  if (!policy?.isActive || policy.retentionDays <= 0) return { accessLogsDeleted: 0, deliveriesDeleted: 0 };
  const cutoff = new Date(now.getTime() - policy.retentionDays * 86_400_000);
  const logs = await prisma.analyticsAccessLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  const deliveries = await prisma.analyticsReportDelivery.deleteMany({ where: { createdAt: { lt: cutoff } } });
  await prisma.retentionActionLog.create({ data: { category: "ANALYTICS_ACCESS_DATA", recordType: "AnalyticsAccessLog", recordId: "batch", action: policy.action, outcome: "APPLIED", detail: JSON.stringify({ accessLogs: logs.count, deliveries: deliveries.count }) } });
  return { accessLogsDeleted: logs.count, deliveriesDeleted: deliveries.count };
}

export async function safeSweepAnalyticsRetention() {
  try {
    return await sweepAnalyticsRetention();
  } catch (error) {
    console.error("[analytics] retention sweep failed", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

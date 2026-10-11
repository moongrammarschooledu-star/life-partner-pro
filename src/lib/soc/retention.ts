import { prisma } from "@/lib/prisma";
import { getSocSettings } from "@/lib/soc/settings";

// STEP 32 — retention for Security Operations data, from the retention periods in the security configuration:
//   access log (who opened which screen)  — kept accessLogRetentionDays (default 365);
//   CLOSED alerts that belong to no incident — kept alertRetentionDays (default 730).
// Never deleted here: open alerts, any alert that is part of an incident (it is evidence in that record), incidents and their timelines,
// rule versions, configuration versions, restore drills, recovery plans and tests. Those are the audit trail of how security was run.

export async function sweepSocRetention(now: Date = new Date()): Promise<{ accessLogsDeleted: number; alertsDeleted: number }> {
  const s = await getSocSettings();
  const logs = await prisma.socAccessLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - s.accessLogRetentionDays * 86_400_000) } } });
  const alertCutoff = new Date(now.getTime() - s.alertRetentionDays * 86_400_000);
  const alerts = await prisma.socAlert.deleteMany({ where: { status: { in: ["CLOSED", "FALSE_POSITIVE"] }, incidentId: null, updatedAt: { lt: alertCutoff } } });
  if (logs.count || alerts.count) {
    await prisma.retentionActionLog.create({ data: { category: "SOC_ACCESS_DATA", recordType: "SocAccessLog+SocAlert", recordId: "batch", action: "DELETE", outcome: "APPLIED", detail: JSON.stringify({ accessLogs: logs.count, closedAlerts: alerts.count }) } });
  }
  return { accessLogsDeleted: logs.count, alertsDeleted: alerts.count };
}

export async function safeSweepSocRetention() {
  try {
    return await sweepSocRetention();
  } catch (error) {
    console.error("[soc] retention sweep failed", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

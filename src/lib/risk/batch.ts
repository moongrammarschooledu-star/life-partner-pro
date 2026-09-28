import { prisma } from "@/lib/prisma";
import { RiskRuleEngine } from "@/lib/risk/rule-engine";
import { runRiskSignalScan } from "@/lib/risk/signal-engine";
import { assessProfile } from "@/lib/risk/assessment-service";
import { rebuildDuplicateClusters } from "@/lib/risk/duplicate-cluster-service";
import { ACTIVE_CASE_STATUSES } from "@/lib/risk/case-service";
import { expireDueControls } from "@/lib/risk/technical-controls";
import { sweepSecurityEvents } from "@/lib/security/event-bus";
import { notifyAdmins, sendNotification } from "@/lib/notifications/notification-service";

// Daily batch (runs inside runDailyTick — the single Hobby-plan cron). Bounded
// by both a profile cap and a time budget so it can never overrun a serverless
// function; whatever is not reached today is reached tomorrow. Like the rest of
// the engine it only creates signals/assessments/review cases and reminders.

const BATCH_PROFILE_LIMIT = 200;
const TIME_BUDGET_MS = 40_000;

export interface RiskBatchSummary {
  profilesEvaluated: number;
  signalsCreated: number;
  truncated: boolean;
  clusters: { clusters: number; created: number; superseded: number };
  expiredControls: number;
  eventsSwept: number;
  remindersSent: number;
}

export async function runRiskBatch(now = new Date()): Promise<RiskBatchSummary> {
  const started = Date.now();
  const since = new Date(now.getTime() - 26 * 3_600_000);

  const [recentEvents, recentProfiles] = await Promise.all([
    prisma.securityEvent.findMany({ where: { createdAt: { gte: since }, profileId: { not: null } }, distinct: ["profileId"], select: { profileId: true }, take: BATCH_PROFILE_LIMIT }),
    prisma.profile.findMany({ where: { createdAt: { gte: since }, softDeleted: false }, select: { id: true }, take: BATCH_PROFILE_LIMIT }),
  ]);
  const ids = [...new Set([...recentEvents.map((e) => e.profileId as string), ...recentProfiles.map((p) => p.id)])].slice(0, BATCH_PROFILE_LIMIT);

  let signalsCreated = 0;
  let evaluated = 0;
  let truncated = false;
  for (const id of ids) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      truncated = true;
      break;
    }
    try {
      const a = await RiskRuleEngine.evaluateProfile(id);
      const b = await runRiskSignalScan(id);
      signalsCreated += a.signalsCreated + b.signalsCreated;
      if (a.signalsCreated > 0) await assessProfile(id);
      evaluated++;
    } catch (error) {
      console.error("[risk-batch] profile evaluation failed", id, error instanceof Error ? error.message : "unknown");
    }
  }

  const clusters = await rebuildDuplicateClusters();
  const expiredControls = await expireDueControls();
  const swept = await sweepSecurityEvents();
  const remindersSent = await sendRiskReviewReminders(now);

  return { profilesEvaluated: evaluated, signalsCreated, truncated, clusters, expiredControls, eventsSwept: swept.deleted, remindersSent };
}

// One reminder per overdue case per day (a RiskCaseEvent marks it), never a flood.
export async function sendRiskReviewReminders(now = new Date()): Promise<number> {
  const overdue = await prisma.riskCase.findMany({
    where: { status: { in: ACTIVE_CASE_STATUSES }, dueAt: { lt: now } },
    select: { id: true, assignedToId: true, subjectProfileId: true, subjectAdminId: true },
    take: 100,
  });
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  let sent = 0;
  for (const c of overdue) {
    const already = await prisma.riskCaseEvent.findFirst({ where: { riskCaseId: c.id, eventType: "REMINDER_SENT", createdAt: { gte: dayStart } }, select: { id: true } });
    if (already) continue;
    if (c.assignedToId) await sendNotification({ adminId: c.assignedToId, type: "RISK_REVIEW_DUE", data: { relatedProfileId: c.subjectProfileId ?? undefined } });
    else if (!c.subjectAdminId) await notifyAdmins({ type: "RISK_REVIEW_DUE", data: { relatedProfileId: c.subjectProfileId ?? undefined }, roles: ["VERIFICATION_MANAGER", "SUPPORT_MANAGER"] });
    await prisma.riskCaseEvent.create({ data: { riskCaseId: c.id, eventType: "REMINDER_SENT", summary: "Review-due reminder sent." } });
    sent++;
  }
  return sent;
}

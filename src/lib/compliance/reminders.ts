import { prisma } from "@/lib/prisma";
import { createFromEvent } from "@/lib/workflow/engine";
import { notifyAdmins } from "@/lib/notifications/notification-service";

// Due-date-driven compliance reminders — the counterpart to the event-driven
// notifications in rules.ts/transfer.ts/data-hold.ts. Runs inside the single
// daily cron tick (src/lib/ops/scheduler.ts — a Hobby-plan Vercel account
// cannot have more than one cron job, matching every other STEP 15+ sweep).
// Every dedup key is day-bucketed so a still-unresolved item reminds once
// per day rather than once per tick forever, and never more than once.

const EXPIRING_SOON_DAYS = 30;

async function remindRulesExpiringOrExpired(day: string) {
  const now = new Date();
  const soon = new Date(now.getTime() + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000);

  const [expiring, expired] = await Promise.all([
    prisma.complianceRule.findMany({ where: { status: "ACTIVE", effectiveTo: { gt: now, lte: soon } } }),
    // A rule whose effectiveTo has already passed but whose status is still
    // ACTIVE (an admin hasn't formally retired/expired it yet) — the rule
    // engine's own read-time filter already excludes it from taking effect,
    // this only flags the stale bookkeeping.
    prisma.complianceRule.findMany({ where: { status: "ACTIVE", effectiveTo: { lte: now } } }),
  ]);

  for (const rule of expiring) {
    await createFromEvent({
      eventName: "COMPLIANCE_RULE_EXPIRING",
      dedupKey: `RULE_EXPIRING:${rule.id}:${day}`,
      resourceType: "CASE",
      resourceId: rule.id,
      taskType: "COMPLIANCE_REVIEW",
      title: `Compliance rule expiring soon — ${rule.ruleCode}`,
      description: `Effective until ${rule.effectiveTo?.toISOString().slice(0, 10)}.`,
    });
    await notifyAdmins({ type: "COMPLIANCE_RULE_EXPIRING", data: { templateVars: { ruleCode: rule.ruleCode } }, roles: ["COMPLIANCE_MANAGER"] });
  }
  for (const rule of expired) {
    await createFromEvent({
      eventName: "COMPLIANCE_RULE_EXPIRED",
      dedupKey: `RULE_EXPIRED:${rule.id}:${day}`,
      resourceType: "CASE",
      resourceId: rule.id,
      taskType: "COMPLIANCE_REVIEW",
      title: `Compliance rule expired but still marked ACTIVE — ${rule.ruleCode}`,
      description: `Effective until ${rule.effectiveTo?.toISOString().slice(0, 10)} — formally retire or supersede it.`,
    });
    await notifyAdmins({ type: "COMPLIANCE_RULE_EXPIRED", data: { templateVars: { ruleCode: rule.ruleCode } }, roles: ["COMPLIANCE_MANAGER"] });
  }
  return { expiring: expiring.length, expired: expired.length };
}

async function remindProcessorsDue(day: string) {
  const now = new Date();
  const due = await prisma.complianceProcessor.findMany({ where: { nextReviewDue: { lte: now } } });

  for (const processor of due) {
    await createFromEvent({
      eventName: "COMPLIANCE_PROVIDER_REVIEW_DUE",
      dedupKey: `PROVIDER_REVIEW_DUE:${processor.id}:${day}`,
      resourceType: "CASE",
      resourceId: processor.id,
      taskType: "COMPLIANCE_REVIEW",
      title: `Processor review due — ${processor.processorCode}`,
      description: `${processor.name} (${processor.serviceType}) was due for review on ${processor.nextReviewDue?.toISOString().slice(0, 10)}.`,
    });
    await notifyAdmins({ type: "COMPLIANCE_PROVIDER_REVIEW_DUE", data: { templateVars: { processorCode: processor.processorCode } }, roles: ["COMPLIANCE_MANAGER"] });
  }
  return { due: due.length };
}

async function remindAuthorityRequestsDue(day: string) {
  const now = new Date();
  const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // 3-day warning — these are typically time-critical
  const due = await prisma.authorityRequest.findMany({
    where: { deadline: { lte: soon }, legalReviewStatus: { in: ["PENDING", "UNDER_REVIEW"] } },
  });

  for (const request of due) {
    await createFromEvent({
      eventName: "COMPLIANCE_AUTHORITY_REQUEST_DUE",
      dedupKey: `AUTHORITY_REQUEST_DUE:${request.id}:${day}`,
      resourceType: "CASE",
      resourceId: request.id,
      taskType: "AUTHORITY_REQUEST_REVIEW",
      priority: "HIGH",
      title: `Authority request deadline approaching — ${request.requestCode}`,
      description: `From ${request.authority}, deadline ${request.deadline?.toISOString().slice(0, 10)}.`,
    });
    await notifyAdmins({ type: "COMPLIANCE_AUTHORITY_REQUEST_DUE", data: { templateVars: { requestCode: request.requestCode } }, roles: ["COMPLIANCE_MANAGER"] });
  }
  return { due: due.length };
}

// The single entry point wired into src/lib/ops/scheduler.ts's runDailyTick().
export async function runComplianceReminders() {
  const day = new Date().toISOString().slice(0, 10);
  const [rules, processors, authorityRequests] = await Promise.all([
    remindRulesExpiringOrExpired(day),
    remindProcessorsDue(day),
    remindAuthorityRequestsDue(day),
  ]);
  return { rules, processors, authorityRequests };
}

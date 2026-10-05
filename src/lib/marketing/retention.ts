import { prisma } from "@/lib/prisma";
import { hasActiveHold } from "@/lib/privacy/data-hold";

// STEP 29 §46 — marketing data retention, plugged into the STEP 13 retention policy table. Two new categories:
//   MARKETING_LEAD_DATA  — unconverted leads (and their form-submission hashes) older than the policy window are
//                          ANONYMISED (or DELETED, per the policy's action). Converted leads are CRM records and are
//                          never touched here. A lead under a legal hold is skipped.
//   MARKETING_EVENT_DATA — raw funnel events and webhook records older than the window are deleted; the daily metric
//                          aggregates are kept.
// There is NO built-in period: with no active admin-created policy for a category nothing is swept (absent policy =
// keep; legal retention periods are never guessed). Consent evidence rows are not swept here — they have no contact
// details and live as long as the lead row; CONSENT_RECORDS retention is the existing STEP 13 policy.

export interface MarketingRetentionResult {
  leadsAnonymized: number;
  leadsDeleted: number;
  leadsSkippedHold: number;
  submissionsDeleted: number;
  eventsDeleted: number;
  webhookEventsDeleted: number;
}

const BATCH = 500;

export async function sweepMarketingRetention(now: Date = new Date()): Promise<MarketingRetentionResult> {
  const result: MarketingRetentionResult = { leadsAnonymized: 0, leadsDeleted: 0, leadsSkippedHold: 0, submissionsDeleted: 0, eventsDeleted: 0, webhookEventsDeleted: 0 };

  const leadPolicy = await prisma.retentionPolicy.findUnique({ where: { category: "MARKETING_LEAD_DATA" } });
  if (leadPolicy?.isActive && leadPolicy.retentionDays > 0 && (leadPolicy.action === "ANONYMIZE" || leadPolicy.action === "DELETE")) {
    const cutoff = new Date(now.getTime() - leadPolicy.retentionDays * 86_400_000);
    const due = await prisma.lead.findMany({
      where: { capturedAt: { lt: cutoff }, convertedProfileId: null, ...(leadPolicy.action === "ANONYMIZE" ? { fullName: { not: "Removed" } } : {}), OR: [{ campaignId: { not: null } }, { platform: { not: null } }] },
      select: { id: true },
      take: BATCH,
    });
    for (const l of due) {
      if (await hasActiveHold({ recordType: "Lead", recordId: l.id })) {
        result.leadsSkippedHold++;
        continue;
      }
      if (leadPolicy.action === "DELETE") {
        await prisma.lead.delete({ where: { id: l.id } });
        result.leadsDeleted++;
      } else {
        await prisma.lead.update({
          where: { id: l.id },
          data: { fullName: "Removed", email: null, phone: null, city: null, area: null, inquiry: null, notes: null, emailHash: null, phoneHash: null, clickIdHash: null, ipHash: null },
        });
        result.leadsAnonymized++;
      }
    }
    const subs = await prisma.leadFormSubmission.deleteMany({ where: { createdAt: { lt: cutoff } } });
    result.submissionsDeleted = subs.count;
    await prisma.retentionActionLog.create({
      data: { category: "MARKETING_LEAD_DATA", recordType: "Lead", recordId: "batch", action: leadPolicy.action, outcome: "APPLIED", detail: JSON.stringify({ anonymized: result.leadsAnonymized, deleted: result.leadsDeleted, skippedHold: result.leadsSkippedHold, submissions: result.submissionsDeleted }) },
    });
  }

  const eventPolicy = await prisma.retentionPolicy.findUnique({ where: { category: "MARKETING_EVENT_DATA" } });
  if (eventPolicy?.isActive && eventPolicy.retentionDays > 0) {
    const cutoff = new Date(now.getTime() - eventPolicy.retentionDays * 86_400_000);
    const events = await prisma.marketingEvent.findMany({ where: { occurredAt: { lt: cutoff } }, select: { id: true }, take: 5000 });
    if (events.length) result.eventsDeleted = (await prisma.marketingEvent.deleteMany({ where: { id: { in: events.map((e) => e.id) } } })).count;
    result.webhookEventsDeleted = (await prisma.marketingWebhookEvent.deleteMany({ where: { receivedAt: { lt: cutoff } } })).count;
    await prisma.retentionActionLog.create({
      data: { category: "MARKETING_EVENT_DATA", recordType: "MarketingEvent", recordId: "batch", action: eventPolicy.action, outcome: "APPLIED", detail: JSON.stringify({ events: result.eventsDeleted, webhookEvents: result.webhookEventsDeleted }) },
    });
  }
  return result;
}

export async function safeSweepMarketingRetention(): Promise<MarketingRetentionResult | null> {
  try {
    return await sweepMarketingRetention();
  } catch (error) {
    console.error("[marketing] retention sweep failed", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

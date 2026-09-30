import { prisma } from "@/lib/prisma";
import { assertCanSeeCrmRecord, type CrmAccessAdmin } from "@/lib/crm/access";
import { listCasesForProfile } from "@/lib/case-access";

// STEP 28 §22/§23 — a genuinely new cross-model read aggregator (no
// pre-existing multi-entity timeline builder exists anywhere in this
// codebase to extend — the closest precedent, getActivityTimeline in
// src/lib/visibility/user-data-visibility.ts, only merges two log tables for
// a profile's own self-view). Permission is checked ONCE at the top (can
// this admin see this CRM record at all) rather than per-event, matching
// every prior STEP's read-only-timeline precedent; every source table
// queried below is itself scoped to this one profileId, so nothing outside
// what the admin's CRM access already covers is ever touched.

export interface TimelineItem {
  sourceType: "AUDIT" | "LIFECYCLE" | "LEAD" | "FOLLOWUP" | "PROPOSAL" | "MEETING" | "SUBSCRIPTION" | "REFERRAL" | "CASE";
  label: string;
  detail?: string;
  actorSource: "USER" | "ADMIN" | "STAFF" | "SYSTEM" | "AUTOMATION" | "AI_ASSISTANT" | "PROVIDER";
  createdAt: Date;
}

export async function getCrmTimeline(crmRecordId: string, admin: CrmAccessAdmin, limit = 200): Promise<TimelineItem[]> {
  const record = await prisma.crmRecord.findUnique({ where: { id: crmRecordId } });
  if (!record) throw new Error("CRM record not found");
  assertCanSeeCrmRecord(admin, record);

  const profileId = record.profileId;
  const items: TimelineItem[] = [];

  const [auditRows, lifecycleRows, followUps, proposals, subscriptionEvents, cases] = await Promise.all([
    prisma.auditLog.findMany({ where: { targetProfileId: profileId }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.crmLifecycleHistory.findMany({ where: { crmRecordId }, orderBy: { createdAt: "desc" } }),
    prisma.followUp.findMany({ where: { crmRecordId }, orderBy: { createdAt: "desc" } }),
    prisma.proposal.findMany({ where: { OR: [{ profileAId: profileId }, { profileBId: profileId }] }, include: { events: true, meetings: true } }),
    prisma.subscriptionEvent.findMany({ where: { subscription: { profileId } }, orderBy: { createdAt: "desc" } }),
    // Reuses the SAME per-admin case-visibility rules as /admin/cases (spec
    // §41 — CRM access never substitutes for a linked domain's own access
    // check); a case this admin isn't assigned/shared on simply never appears.
    listCasesForProfile(profileId, admin),
  ]);

  for (const row of auditRows) {
    items.push({ sourceType: "AUDIT", label: row.action, actorSource: row.adminId ? "ADMIN" : "SYSTEM", createdAt: row.createdAt });
  }
  for (const row of lifecycleRows) {
    items.push({
      sourceType: "LIFECYCLE",
      label: `Lifecycle: ${row.fromStage ?? "—"} → ${row.toStage}`,
      detail: row.reason ?? undefined,
      actorSource: row.triggeredBy === "MANUAL" ? "ADMIN" : row.triggeredBy === "PROFILE_STATUS_SYNC" ? "SYSTEM" : "AUTOMATION",
      createdAt: row.createdAt,
    });
  }
  for (const followUp of followUps) {
    items.push({ sourceType: "FOLLOWUP", label: `Follow-up created${followUp.type ? `: ${followUp.type}` : ""}`, actorSource: "STAFF", createdAt: followUp.createdAt });
    if (followUp.completedAt) items.push({ sourceType: "FOLLOWUP", label: "Follow-up completed", detail: followUp.outcome ?? undefined, actorSource: "STAFF", createdAt: followUp.completedAt });
  }
  for (const proposal of proposals) {
    for (const event of proposal.events) {
      items.push({ sourceType: "PROPOSAL", label: `Proposal ${event.status}`, detail: event.note ?? undefined, actorSource: event.performedByAdminId ? "ADMIN" : "USER", createdAt: event.createdAt });
    }
    for (const meeting of proposal.meetings) {
      items.push({ sourceType: "MEETING", label: `Meeting ${meeting.status}`, detail: meeting.meetingType, actorSource: "STAFF", createdAt: meeting.scheduledAt });
    }
  }
  for (const row of subscriptionEvents) {
    items.push({ sourceType: "SUBSCRIPTION", label: `Subscription: ${row.fromStatus ?? "—"} → ${row.toStatus}`, detail: row.reason ?? undefined, actorSource: "SYSTEM", createdAt: row.createdAt });
  }
  for (const row of cases) {
    items.push({ sourceType: "CASE", label: `Case ${row.caseNumber}: ${row.status}`, detail: row.subject, actorSource: "STAFF", createdAt: row.updatedAt });
  }

  if (record.leadId) {
    const leadEvents = await prisma.leadEvent.findMany({ where: { leadId: record.leadId }, orderBy: { createdAt: "desc" } });
    for (const row of leadEvents) {
      items.push({ sourceType: "LEAD", label: `Lead: ${row.fromStatus ?? "—"} → ${row.toStatus}`, detail: row.reason ?? undefined, actorSource: row.actorId ? "ADMIN" : "SYSTEM", createdAt: row.createdAt });
    }
  }
  if (record.referralId) {
    const referralEvents = await prisma.referralEvent.findMany({ where: { referralId: record.referralId }, orderBy: { createdAt: "desc" } });
    for (const row of referralEvents) {
      items.push({ sourceType: "REFERRAL", label: row.eventType, actorSource: "SYSTEM", createdAt: row.createdAt });
    }
  }

  return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
}

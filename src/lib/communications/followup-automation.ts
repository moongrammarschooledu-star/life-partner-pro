import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { createFromEvent } from "@/lib/workflow/engine";
import { getPolicy } from "@/lib/communications/policy-config";
import type { AdminTaskType, AssignmentResourceType } from "@prisma/client";

// FollowUpAutomationService (spec §31-§33). Every rule is CONFIGURABLE (a versioned CommunicationPolicy row) and ships DISABLED, so
// turning this system on changes nothing until a manager opts a rule in. What a rule can do is deliberately small:
//   1. create a follow-up TASK for staff (deduplicated - never a second open task for the same record), and
//   2. optionally send the ONE existing, approved reminder notification, through the normal policy engine (consent, suppression,
//      frequency, jurisdiction ...) with a hard cap on automated follow-ups per recipient.
// It never sends free text and never repeats indefinitely: repeats are bounded by maxRepeats spaced by cooldownDays.

export const FOLLOWUP_TRIGGERS = ["PROPOSAL_NO_RESPONSE", "VERIFICATION_STALLED", "MEETING_COMPLETED", "SUPPORT_UNANSWERED", "PROFILE_INCOMPLETE"] as const;
export type FollowUpTrigger = (typeof FOLLOWUP_TRIGGERS)[number];

export interface FollowUpRule {
  enabled: boolean;
  trigger: FollowUpTrigger;
  waitDays: number;
  cooldownDays: number;
  maxRepeats: number;
  createTask: boolean;
  notifyUser: boolean; // only honoured for PROPOSAL_NO_RESPONSE (the one approved reminder that exists)
}

export const FOLLOWUP_RULE_DEFAULTS: Record<string, FollowUpRule> = {
  "proposal-no-response": { enabled: false, trigger: "PROPOSAL_NO_RESPONSE", waitDays: 3, cooldownDays: 3, maxRepeats: 2, createTask: true, notifyUser: false },
  "verification-stalled": { enabled: false, trigger: "VERIFICATION_STALLED", waitDays: 5, cooldownDays: 5, maxRepeats: 2, createTask: true, notifyUser: false },
  "meeting-follow-up": { enabled: false, trigger: "MEETING_COMPLETED", waitDays: 1, cooldownDays: 7, maxRepeats: 1, createTask: true, notifyUser: false },
  "support-unanswered": { enabled: false, trigger: "SUPPORT_UNANSWERED", waitDays: 2, cooldownDays: 2, maxRepeats: 3, createTask: true, notifyUser: false },
  "profile-incomplete": { enabled: false, trigger: "PROFILE_INCOMPLETE", waitDays: 7, cooldownDays: 14, maxRepeats: 2, createTask: true, notifyUser: false },
};

export function validateFollowUpRule(key: string, raw: unknown): FollowUpRule {
  if (!(key in FOLLOWUP_RULE_DEFAULTS)) throw new HttpError(404, "Unknown follow-up rule.");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(422, "The rule must be an object.");
  const base = FOLLOWUP_RULE_DEFAULTS[key];
  const r = { ...base, ...(raw as Partial<FollowUpRule>), trigger: base.trigger }; // the trigger of a rule key is fixed
  const int = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
  if (typeof r.enabled !== "boolean" || typeof r.createTask !== "boolean" || typeof r.notifyUser !== "boolean") throw new HttpError(422, "enabled, createTask and notifyUser must be true or false.");
  if (!int(r.waitDays, 1, 90) || !int(r.cooldownDays, 1, 90) || !int(r.maxRepeats, 1, 5)) throw new HttpError(422, "waitDays / cooldownDays must be 1-90 and maxRepeats 1-5.");
  if (r.notifyUser && r.trigger !== "PROPOSAL_NO_RESPONSE") throw new HttpError(422, "Only the proposal reminder can notify the applicant.");
  if (!r.createTask && !r.notifyUser && r.enabled) throw new HttpError(422, "An enabled rule must create a task or notify.");
  return r;
}

export async function loadFollowUpRules(): Promise<Record<string, FollowUpRule>> {
  const out: Record<string, FollowUpRule> = { ...FOLLOWUP_RULE_DEFAULTS };
  const rows = await prisma.communicationPolicy.findMany({ where: { kind: "FOLLOWUP_RULE", status: "ACTIVE" }, orderBy: { version: "desc" } });
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.policyKey) || !(row.policyKey in FOLLOWUP_RULE_DEFAULTS)) continue;
    seen.add(row.policyKey);
    try {
      out[row.policyKey] = validateFollowUpRule(row.policyKey, JSON.parse(row.configuration));
    } catch {
      // a corrupt row falls back to the (disabled) default rather than firing unpredictably
    }
  }
  return out;
}

const DAY = 86_400_000;

// Which repeat number applies now: 0 for the first follow-up, then one more every cooldownDays, capped by maxRepeats. The dedup key
// includes it, so the same repeat can never create a second task even if the job runs many times.
export function repeatIndex(sinceMs: number, rule: Pick<FollowUpRule, "waitDays" | "cooldownDays" | "maxRepeats">): number | null {
  const overdue = sinceMs - rule.waitDays * DAY;
  if (overdue < 0) return null;
  const idx = Math.floor(overdue / (rule.cooldownDays * DAY));
  return idx < rule.maxRepeats ? idx : null;
}

export interface FollowUpRunSummary {
  tasksCreated: number;
  notified: number;
  skipped: number;
  byRule: Record<string, number>;
}

async function task(summary: FollowUpRunSummary, ruleKey: string, idx: number, resourceType: AssignmentResourceType, resourceId: string, taskType: AdminTaskType, title: string, description: string, assignedToId?: string | null) {
  const created = await createFromEvent({ eventName: `FOLLOWUP_AUTOMATION_${ruleKey}`, dedupKey: `FOLLOWUP_AUTO:${ruleKey}:${resourceId}:${idx}`, resourceType, resourceId, taskType, title, description, assignedToId: assignedToId ?? undefined });
  if (created) {
    summary.tasksCreated++;
    summary.byRule[ruleKey] = (summary.byRule[ruleKey] ?? 0) + 1;
  } else summary.skipped++;
}

export async function runFollowUpAutomation(now: Date = new Date()): Promise<FollowUpRunSummary> {
  const summary: FollowUpRunSummary = { tasksCreated: 0, notified: 0, skipped: 0, byRule: {} };
  const rules = await loadFollowUpRules();
  const { config: freq } = await getPolicy("FREQUENCY");

  // 1. Proposals still awaiting a response.
  const p = rules["proposal-no-response"];
  if (p.enabled) {
    const proposals = await prisma.proposal.findMany({ where: { status: { in: ["WAITING_FOR_PROFILE_A", "WAITING_FOR_PROFILE_B", "BOTH_REVIEWING"] }, updatedAt: { lte: new Date(now.getTime() - p.waitDays * DAY) } }, select: { id: true, proposalCode: true, updatedAt: true, assignedToId: true, profileAId: true, profileBId: true }, take: 200 });
    for (const proposal of proposals) {
      const idx = repeatIndex(now.getTime() - proposal.updatedAt.getTime(), p);
      if (idx === null) continue;
      if (p.createTask) await task(summary, "proposal-no-response", idx, "PROPOSAL", proposal.id, "PROPOSAL_FOLLOWUP", "Proposal has had no response", `Proposal ${proposal.proposalCode ?? ""} has been waiting ${p.waitDays}+ days for a response.`, proposal.assignedToId);
      if (p.notifyUser) {
        const already = await prisma.communicationLog.count({ where: { purpose: "FOLLOWUP", createdById: null, profileId: { in: [proposal.profileAId, proposal.profileBId] }, createdAt: { gte: new Date(now.getTime() - 30 * DAY) } } });
        if (already >= freq.maxAutomatedFollowups * 2) {
          summary.skipped++;
          continue;
        }
        const { notifyProposalPendingReminder } = await import("@/lib/notifications/events");
        await notifyProposalPendingReminder({ id: proposal.id, profileAId: proposal.profileAId, profileBId: proposal.profileBId });
        summary.notified++;
      }
    }
  }

  // 2. Verification that has been stuck.
  const v = rules["verification-stalled"];
  if (v.enabled && v.createTask) {
    const rows = await prisma.profileVerification.findMany({ where: { status: { in: ["VERIFICATION_PENDING", "VERIFICATION_REQUIRED", "RE_VERIFICATION_REQUIRED"] }, updatedAt: { lte: new Date(now.getTime() - v.waitDays * DAY) } }, select: { profileId: true, updatedAt: true }, take: 200 });
    for (const row of rows) {
      const idx = repeatIndex(now.getTime() - row.updatedAt.getTime(), v);
      if (idx !== null) await task(summary, "verification-stalled", idx, "PROFILE", row.profileId, "VERIFICATION_REVIEW", "Verification has stalled", `Verification has not progressed for ${v.waitDays}+ days.`);
    }
  }

  // 3. Meetings that have taken place.
  const m = rules["meeting-follow-up"];
  if (m.enabled && m.createTask) {
    const meetings = await prisma.meeting.findMany({ where: { status: "COMPLETED", scheduledAt: { lte: new Date(now.getTime() - m.waitDays * DAY) } }, select: { id: true, proposalId: true, scheduledAt: true, proposal: { select: { assignedToId: true } } }, take: 200 });
    for (const meeting of meetings) {
      const idx = repeatIndex(now.getTime() - meeting.scheduledAt.getTime(), m);
      if (idx !== null) await task(summary, "meeting-follow-up", idx, "PROPOSAL", meeting.proposalId, "MEETING_FOLLOWUP", "Follow up after a completed meeting", "A meeting has been completed; collect feedback and update the proposal.", meeting.proposal.assignedToId);
    }
  }

  // 4. Support cases nobody has answered.
  const s = rules["support-unanswered"];
  if (s.enabled && s.createTask) {
    const cases = await prisma.case.findMany({ where: { status: "NEW", firstRespondedAt: null, softDeletedAt: null, createdAt: { lte: new Date(now.getTime() - s.waitDays * DAY) } }, select: { id: true, createdAt: true }, take: 200 });
    for (const c of cases) {
      const idx = repeatIndex(now.getTime() - c.createdAt.getTime(), s);
      if (idx !== null) await task(summary, "support-unanswered", idx, "CASE", c.id, "SUPPORT_CASE_TASK", "Support request still unanswered", `A support request has had no response for ${s.waitDays}+ days.`);
    }
  }

  // 5. Profiles left incomplete (staff task only - no message to the applicant).
  const i = rules["profile-incomplete"];
  if (i.enabled && i.createTask) {
    const profiles = await prisma.profile.findMany({ where: { softDeleted: false, accountStatus: "ACTIVE", profileCompletion: { lt: 80 }, createdAt: { lte: new Date(now.getTime() - i.waitDays * DAY) }, status: { in: ["NEW", "UNDER_REVIEW"] } }, select: { id: true, createdAt: true }, take: 200 });
    for (const pr of profiles) {
      const idx = repeatIndex(now.getTime() - pr.createdAt.getTime(), i);
      if (idx !== null) await task(summary, "profile-incomplete", idx, "PROFILE", pr.id, "GENERAL_ADMIN_TASK", "Profile still incomplete", "The profile is still missing information; consider a friendly reminder.");
    }
  }

  if (summary.tasksCreated + summary.notified > 0) await writeAudit({ action: "COMMUNICATION_QUEUE_PROCESSED", meta: { followUpAutomation: true, ...summary } });
  return summary;
}

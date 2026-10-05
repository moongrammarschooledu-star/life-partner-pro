import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { createFromEvent } from "@/lib/workflow/engine";
import { transitionStage } from "@/lib/crm/lifecycle-service";
import { canAccessRecord } from "@/lib/family/access-control";
import { sendNotification } from "@/lib/notifications/notification-service";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { engagementAudit } from "@/lib/engagement/audit";
import { ENGAGEMENT_FLAGS, REMINDER_NOTIFICATION, RUN_BATCH_SIZE, type ReminderKind } from "@/lib/engagement/constants";
import { deliverReminder } from "@/lib/engagement/deliver";
import { conditionsMatch } from "@/lib/engagement/eligibility";
import { loadEngagementSnapshot } from "@/lib/engagement/read-model";
import { scheduleReminder } from "@/lib/engagement/reminders";
import { parseDefinition, type WorkflowDefinition, type WorkflowStep } from "@/lib/engagement/workflow-schema";
import type { EngagementEventType, EngagementWorkflowRun } from "@prisma/client";

// STEP 30 — the workflow engine. A published workflow is: WHEN <event> IF <conditions> then run <steps>. Each (workflow, event)
// pair gets exactly ONE run (unique key), each step is executed at most once (steps carry deterministic dedup keys into
// the task / reminder tables), WAIT steps park the run until a later daily tick, and a RECHECK step re-evaluates the
// conditions and the cancel-on events so a run stops the moment the applicant has done the thing. Anything missing or
// malformed fails closed: the run is SKIPPED / CANCELLED / FAILED and nothing is sent.

export interface EngagementEventRef {
  id: string;
  eventKey: string;
  profileId: string;
  type: EngagementEventType;
  refType: string | null;
  refId: string | null;
  occurredAt: Date;
}

const MAX_ATTEMPTS = 3;
const HOUR = 3_600_000;

export async function onEngagementEvent(ev: EngagementEventRef): Promise<{ started: number; cancelled: number }> {
  const cancelled = await cancelRunsOnEvent(ev);
  const workflows = await prisma.engagementWorkflow.findMany({ where: { trigger: ev.type, status: "PUBLISHED", publishedVersionId: { not: null } }, select: { id: true, publishedVersionId: true } });
  let started = 0;
  for (const w of workflows) {
    if (await startRun(w.id, w.publishedVersionId as string, ev)) started++;
  }
  return { started, cancelled };
}

async function loadDefinition(versionId: string): Promise<WorkflowDefinition | null> {
  const v = await prisma.engagementWorkflowVersion.findUnique({ where: { id: versionId }, select: { definition: true } });
  if (!v) return null;
  try {
    return parseDefinition(v.definition);
  } catch {
    return null; // a stored definition that no longer validates is never executed
  }
}

async function startRun(workflowId: string, versionId: string, ev: EngagementEventRef): Promise<boolean> {
  const def = await loadDefinition(versionId);
  const code = await nextSequenceCode("ENG");
  let run: EngagementWorkflowRun;
  try {
    run = await prisma.engagementWorkflowRun.create({ data: { code, workflowId, versionId, profileId: ev.profileId, eventKey: ev.eventKey, status: def ? "ACTIVE" : "FAILED", nextRunAt: new Date(), lastNote: def ? null : "DEFINITION_INVALID" } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return false; // this event already started this workflow
    throw error;
  }
  if (!def) return false;
  const snapshot = await loadEngagementSnapshot(ev.profileId);
  if (!snapshot) return end(run.id, "SKIPPED", "PROFILE_NOT_FOUND");
  const m = conditionsMatch(def.conditions, snapshot);
  if (!m.match) {
    await end(run.id, "SKIPPED", `CONDITION_${m.failed}`);
    return false;
  }
  await engagementAudit({ action: "ENGAGEMENT_WORKFLOW_RUN", targetProfileId: ev.profileId, resource: "engagement_run", resourceId: run.id, after: { workflowId, trigger: ev.type, code } }).catch(() => undefined);
  await advanceRun(run.id);
  return true;
}

async function end(runId: string, status: "COMPLETED" | "CANCELLED" | "SKIPPED" | "FAILED", note: string): Promise<boolean> {
  await prisma.engagementWorkflowRun.update({ where: { id: runId }, data: { status, lastNote: note.slice(0, 200), completedAt: new Date(), nextRunAt: null } });
  return false;
}

async function cancelRunsOnEvent(ev: EngagementEventRef): Promise<number> {
  const active = await prisma.engagementWorkflowRun.findMany({ where: { profileId: ev.profileId, status: "ACTIVE" }, select: { id: true, versionId: true, eventKey: true }, take: 200 });
  let n = 0;
  const byVersion = new Map<string, WorkflowDefinition | null>();
  for (const run of active) {
    if (run.eventKey === ev.eventKey) continue; // the event that started it never cancels it
    if (!byVersion.has(run.versionId)) byVersion.set(run.versionId, await loadDefinition(run.versionId));
    const def = byVersion.get(run.versionId);
    if (def?.cancelOn.includes(ev.type)) {
      await end(run.id, "CANCELLED", `CANCEL_EVENT_${ev.type}`);
      await prisma.engagementReminder.updateMany({ where: { runId: run.id, state: { in: ["SCHEDULED", "ELIGIBLE"] } }, data: { state: "CANCELLED", cancelledAt: new Date(), cancelReason: "RUN_CANCELLED" } });
      n++;
    }
  }
  return n;
}

export async function advanceDueRuns(now: Date = new Date(), limit: number = RUN_BATCH_SIZE): Promise<{ advanced: number; failed: number }> {
  if (!(await isFeatureEnabled(ENGAGEMENT_FLAGS.master)) || !(await isFeatureEnabled(ENGAGEMENT_FLAGS.workflows))) return { advanced: 0, failed: 0 };
  const due = await prisma.engagementWorkflowRun.findMany({
    where: { status: "ACTIVE", nextRunAt: { lte: now }, workflow: { status: "PUBLISHED" } }, // a paused or archived workflow is not advanced
    orderBy: { nextRunAt: "asc" }, take: limit, select: { id: true },
  });
  let advanced = 0;
  let failed = 0;
  for (const r of due) {
    try {
      await advanceRun(r.id, now);
      advanced++;
    } catch (error) {
      failed++;
      console.error("[engagement] run failed", error instanceof Error ? error.message : "error");
    }
  }
  return { advanced, failed };
}

export async function advanceRun(runId: string, now: Date = new Date()): Promise<void> {
  const run = await prisma.engagementWorkflowRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "ACTIVE") return;
  const def = await loadDefinition(run.versionId);
  if (!def) {
    await end(run.id, "FAILED", "DEFINITION_INVALID");
    return;
  }
  const ev = await prisma.engagementEvent.findUnique({ where: { eventKey: run.eventKey } });
  if (!ev) {
    await end(run.id, "FAILED", "TRIGGER_EVENT_MISSING");
    return;
  }

  let index = run.stepIndex;
  try {
    while (index < def.steps.length) {
      const step = def.steps[index];
      if (step.type === "WAIT") {
        await prisma.engagementWorkflowRun.update({ where: { id: run.id }, data: { stepIndex: index + 1, nextRunAt: new Date(now.getTime() + step.hours * HOUR) } });
        return; // parked until a later tick
      }
      const result = await executeStep(step, def, run, ev, index, now);
      if (result === "STOP") return; // the step ended the run (cancelled / skipped)
      index++;
      await prisma.engagementWorkflowRun.update({ where: { id: run.id }, data: { stepIndex: index } });
    }
    await end(run.id, "COMPLETED", "ALL_STEPS_DONE");
  } catch (error) {
    const attempts = run.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) await end(run.id, "FAILED", `STEP_ERROR_${index}`);
    else await prisma.engagementWorkflowRun.update({ where: { id: run.id }, data: { attempts, nextRunAt: new Date(now.getTime() + 24 * HOUR), lastNote: `RETRY_AFTER_ERROR_STEP_${index}` } });
    console.error("[engagement] step failed", error instanceof Error ? error.message : "error");
  }
}

async function executeStep(step: WorkflowStep, def: WorkflowDefinition, run: EngagementWorkflowRun, ev: { profileId: string; type: EngagementEventType; refType: string | null; refId: string | null }, index: number, now: Date): Promise<"CONTINUE" | "STOP"> {
  const stepKey = `ENG:${run.id}:${index}`; // deterministic: a retried step cannot create a second task / reminder
  switch (step.type) {
    case "WAIT":
      return "CONTINUE";
    case "RECHECK_ELIGIBLE": {
      const snapshot = await loadEngagementSnapshot(run.profileId, now);
      if (!snapshot) return stop(run.id, "SKIPPED", "PROFILE_NOT_FOUND");
      const m = conditionsMatch(def.conditions, snapshot);
      if (!m.match) return stop(run.id, "CANCELLED", `NO_LONGER_ELIGIBLE_${m.failed}`);
      // an applicant action since the run began cancels it even if the conditions still happen to hold
      if (def.cancelOn.length) {
        const acted = await prisma.engagementEvent.count({ where: { profileId: run.profileId, type: { in: def.cancelOn as EngagementEventType[] }, occurredAt: { gt: run.startedAt } } });
        if (acted > 0) return stop(run.id, "CANCELLED", "CANCEL_EVENT_SEEN");
      }
      return "CONTINUE";
    }
    case "CREATE_TASK": {
      const onProposal = ev.refType === "PROPOSAL" && ev.refId && (step.taskType === "PROPOSAL_FOLLOWUP" || step.taskType === "MEETING_FOLLOWUP");
      await createFromEvent({
        eventName: `engagement.${ev.type}`, dedupKey: stepKey, resourceType: onProposal ? "PROPOSAL" : "PROFILE", resourceId: onProposal ? (ev.refId as string) : run.profileId,
        taskType: step.taskType as never, priority: "NORMAL", title: step.title ?? undefined,
      });
      return "CONTINUE";
    }
    case "NOTIFY_APPLICANT": {
      const { reminder } = await scheduleReminder({ profileId: run.profileId, kind: step.kind, dueAt: now, refType: ev.refType, refId: ev.refId, runId: run.id, dedupKey: stepKey });
      await deliverReminder(reminder.id, now);
      return "CONTINUE";
    }
    case "REQUEST_FEEDBACK": {
      const { reminder } = await scheduleReminder({ profileId: run.profileId, kind: "FEEDBACK_REQUEST", dueAt: now, refType: ev.refType, refId: ev.refId, runId: run.id, dedupKey: stepKey });
      await deliverReminder(reminder.id, now);
      return "CONTINUE";
    }
    case "NOTIFY_FAMILY": {
      await notifyFamilyMembers(run.profileId, step.kind, ev.refType, ev.refId);
      return "CONTINUE";
    }
    case "UPDATE_CRM_STAGE": {
      const crm = await prisma.crmRecord.findUnique({ where: { profileId: run.profileId }, select: { id: true } });
      if (crm) {
        try {
          await transitionStage({ crmRecordId: crm.id, toStage: step.toStage, triggeredBy: "AUTOMATION", reason: "Engagement workflow" });
        } catch {
          // forward-only guard: an invalid move is skipped, never forced
        }
      }
      return "CONTINUE";
    }
  }
}

async function stop(runId: string, status: "CANCELLED" | "SKIPPED", note: string): Promise<"STOP"> {
  await end(runId, status, note);
  await prisma.engagementReminder.updateMany({ where: { runId, state: { in: ["SCHEDULED", "ELIGIBLE"] } }, data: { state: "CANCELLED", cancelledAt: new Date(), cancelReason: "RUN_ENDED" } });
  return "STOP";
}

// Family members receive an engagement reminder ONLY for a record the applicant has shared with them (canAccessRecord checks the
// share, its access level and the member's delegated permission). No share -> no message. Family messages are in-app only.
export async function notifyFamilyMembers(profileId: string, kind: "PROPOSAL_PENDING" | "MEETING_UNCONFIRMED", refType: string | null, refId: string | null): Promise<number> {
  if (!refId) return 0;
  const recordType = kind === "PROPOSAL_PENDING" ? "PROPOSAL" : "MEETING";
  if (refType !== recordType) return 0;
  const members = await prisma.familyMember.findMany({ where: { familyAccount: { applicantId: profileId }, status: "ACTIVE", removedAt: null }, select: { id: true }, take: 20 });
  let sent = 0;
  for (const m of members) {
    if (!(await canAccessRecord(m.id, recordType, refId))) continue;
    await sendNotification({ familyMemberId: m.id, type: REMINDER_NOTIFICATION[kind as ReminderKind], data: { relatedProposalId: recordType === "PROPOSAL" ? refId : undefined } });
    sent++;
  }
  return sent;
}

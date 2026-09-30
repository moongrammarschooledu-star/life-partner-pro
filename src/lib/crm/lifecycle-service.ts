import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { createFromEvent } from "@/lib/workflow/engine";
import { notifyCrmStageChanged } from "@/lib/notifications/events";
import type { CrmLifecycleStage, TriggerSource, AdminTaskType } from "@prisma/client";

// STEP 28 §5/§6 — ApplicantLifecycleService. Every transition is validated
// against the state machine below before anything is written; history is
// append-only (no update/delete path is ever exposed for CrmLifecycleHistory).
// Profile.status is never read or written here — see profile-status-sync.ts
// for the one-way sync hook that runs in the opposite direction.

const FORWARD_PATH: CrmLifecycleStage[] = [
  "REGISTERED",
  "PROFILE_INCOMPLETE",
  "PROFILE_SUBMITTED",
  "UNDER_REVIEW",
  "VERIFICATION_PENDING",
  "VERIFIED",
  "ACTIVE",
  "MATCHING",
  "PROPOSAL_ACTIVE",
  "WAITING_FOR_RESPONSE",
  "MUTUAL_INTEREST",
  "CONTACT_COORDINATION",
  "MEETING_SCHEDULED",
  "MEETING_COMPLETED",
  "FOLLOWUP",
  "FURTHER_DISCUSSION",
  "FINALIZATION_REVIEW",
  "FINALIZED",
  "MARRIED",
];

// Exit states reachable from (almost) any active stage — spec §6's
// "configurable alternative paths". MARRIED/ARCHIVED are themselves terminal.
const EXIT_STAGES: CrmLifecycleStage[] = ["ON_HOLD", "NOT_INTERESTED", "REJECTED", "DEACTIVATED", "SUSPENDED", "ARCHIVED"];
const TERMINAL_STAGES: CrmLifecycleStage[] = ["MARRIED", "ARCHIVED"];

function forwardIndex(stage: CrmLifecycleStage): number {
  return FORWARD_PATH.indexOf(stage);
}

// Pure — no I/O. A transition is valid if: moving forward one-or-more steps
// on the main path, moving from an exit stage back onto the main path at or
// after where it left off (re-activation), or moving from any non-terminal
// stage into any exit stage (spec §6's configurable alternative paths).
export function validateTransition(fromStage: CrmLifecycleStage | null, toStage: CrmLifecycleStage): boolean {
  if (fromStage === null) return true; // initial assignment on record creation
  if (TERMINAL_STAGES.includes(fromStage)) return false;
  if (fromStage === toStage) return false;

  if (EXIT_STAGES.includes(toStage)) return true; // any active stage -> any exit stage

  const fromIsExit = EXIT_STAGES.includes(fromStage);
  const fromIdx = forwardIndex(fromStage);
  const toIdx = forwardIndex(toStage);
  if (toIdx === -1) return false; // toStage isn't on the main path and isn't an exit stage — invalid

  if (fromIsExit) return true; // re-activation from ON_HOLD/etc. onto any main-path stage is allowed; a human chose the target deliberately
  return toIdx > fromIdx; // forward-only on the main path, never backward
}

export async function getLifecycleStage(crmRecordId: string): Promise<CrmLifecycleStage | null> {
  const record = await prisma.crmRecord.findUnique({ where: { id: crmRecordId }, select: { lifecycleStage: true } });
  return record?.lifecycleStage ?? null;
}

export async function getLifecycleHistory(crmRecordId: string) {
  return prisma.crmLifecycleHistory.findMany({ where: { crmRecordId }, orderBy: { createdAt: "asc" } });
}

// The one place a CrmLifecycleHistory row is ever written — no update/delete
// path is exposed anywhere in this module.
export async function recordLifecycleEvent(params: { crmRecordId: string; fromStage: CrmLifecycleStage | null; toStage: CrmLifecycleStage; reason?: string; triggeredBy: TriggerSource; actorId?: string }) {
  return prisma.crmLifecycleHistory.create({
    data: {
      crmRecordId: params.crmRecordId,
      fromStage: params.fromStage,
      toStage: params.toStage,
      reason: params.reason,
      triggeredBy: params.triggeredBy,
      actorId: params.actorId,
    },
  });
}

export class InvalidLifecycleTransitionError extends Error {}

export async function transitionStage(params: { crmRecordId: string; toStage: CrmLifecycleStage; actorId?: string; reason?: string; triggeredBy: TriggerSource }) {
  const record = await prisma.crmRecord.findUnique({ where: { id: params.crmRecordId } });
  if (!record) throw new Error("CRM record not found");

  if (!validateTransition(record.lifecycleStage, params.toStage)) {
    throw new InvalidLifecycleTransitionError(`Cannot move a CRM record from ${record.lifecycleStage} to ${params.toStage}.`);
  }

  const [, updated] = await prisma.$transaction([
    recordLifecycleEventTx(params),
    prisma.crmRecord.update({ where: { id: params.crmRecordId }, data: { lifecycleStage: params.toStage, lastActivityAt: new Date() } }),
  ]);

  await writeAudit({ action: "CRM_LIFECYCLE_TRANSITIONED", adminId: params.actorId, targetProfileId: record.profileId, meta: { crmRecordId: record.id, fromStage: record.lifecycleStage, toStage: params.toStage, reason: params.reason, triggeredBy: params.triggeredBy } });
  await triggerLifecycleNotifications(record.assignedStaffId, record.id, params.toStage).catch(() => undefined);

  return updated;
}

// Prisma doesn't let a $transaction array mix a direct create() with the
// exact same shape as recordLifecycleEvent's standalone version without
// re-declaring it — kept as a tiny private helper so recordLifecycleEvent
// itself stays the single public, standalone-callable version (used by
// profile-status-sync.ts, which does NOT want the validateTransition guard).
function recordLifecycleEventTx(params: { crmRecordId: string; toStage: CrmLifecycleStage; reason?: string; triggeredBy: TriggerSource; actorId?: string }) {
  return prisma.crmLifecycleHistory.create({
    data: { crmRecordId: params.crmRecordId, toStage: params.toStage, reason: params.reason, triggeredBy: params.triggeredBy, actorId: params.actorId },
  });
}

export async function createLifecycleTask(crmRecordId: string, taskType: AdminTaskType, title: string, dedupSuffix?: string) {
  return createFromEvent({
    eventName: `crm.lifecycle.${taskType.toLowerCase()}`,
    dedupKey: `${taskType}:${crmRecordId}${dedupSuffix ? `:${dedupSuffix}` : ""}`,
    resourceType: "CRM_RECORD",
    resourceId: crmRecordId,
    taskType,
    title,
  });
}

export async function triggerLifecycleNotifications(assignedStaffId: string | null | undefined, crmRecordId: string, toStage: CrmLifecycleStage) {
  await notifyCrmStageChanged(assignedStaffId, crmRecordId, toStage);
}

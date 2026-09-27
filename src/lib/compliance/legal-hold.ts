import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { liftHold } from "@/lib/privacy/data-hold";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import type { SessionAdmin } from "@/lib/route-guard";

// Plan decision 6 — closes a real, disclosed gap: liftHold() (STEP 13) was a
// single unilateral admin action with zero second-approver requirement,
// despite spec §28's "no ordinary admin may override a legal hold." This
// splits release into a request step (gated via the new LEGAL_HOLD_RELEASE
// catalog entry) and an execute step that only ever runs once the gate
// clears — liftHold() itself is reused unchanged as the low-level primitive
// that actually flips `active: false`, so hasActiveHold() and every existing
// reader keep working exactly as before.

export interface RequestHoldReleaseResult {
  requiresApproval: boolean;
  status?: string;
  approvalRequestId?: string;
  approvalCode?: string;
}

export async function requestHoldRelease(holdId: string, actor: SessionAdmin, reason: string): Promise<RequestHoldReleaseResult> {
  const existing = await prisma.dataHold.findUniqueOrThrow({ where: { id: holdId } });
  if (!existing.active) throw new Error("Hold is not active");
  if (existing.holdStatus === "RELEASE_PENDING") throw new Error("A release request is already pending for this hold");

  const gate = await enforceApprovalGate({
    actionType: "LEGAL_HOLD_RELEASE",
    sourceType: "CASE",
    sourceId: holdId,
    actor,
    reason,
    currentStatePayload: { holdStatus: existing.holdStatus },
    requestedPayload: { holdStatus: "RELEASED" },
  });

  await prisma.dataHold.update({ where: { id: holdId }, data: { holdStatus: "RELEASE_PENDING" } });
  await writeAudit({ action: "LEGAL_HOLD_RELEASE_REQUESTED", adminId: actor.id, targetProfileId: existing.profileId, meta: { holdId, reason } });

  if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") {
    return { requiresApproval: true, status: gate.status, approvalRequestId: gate.approvalRequestId, approvalCode: gate.approvalCode };
  }

  return {
    requiresApproval: gate.requiresApproval,
    status: gate.requiresApproval ? gate.status : undefined,
    approvalRequestId: gate.requiresApproval ? gate.approvalRequestId : undefined,
  };
}

// Only ever called once the gate is READY_TO_EXECUTE (or immediately, when
// the policy doesn't require approval at all) — never a second unilateral
// path. `hold.active` still reads true for the entire RELEASE_PENDING window,
// which is the point: a pending release request grants no early access.
export async function executeHoldRelease(holdId: string, actor: SessionAdmin, approvalRequestId?: string) {
  const existing = await prisma.dataHold.findUniqueOrThrow({ where: { id: holdId } });
  if (existing.holdStatus !== "RELEASE_PENDING") {
    throw new Error(`Hold is not awaiting release (current status: ${existing.holdStatus})`);
  }

  await liftHold(holdId, actor.id);
  const hold = await prisma.dataHold.update({ where: { id: holdId }, data: { holdStatus: "RELEASED", approvedById: actor.id } });

  if (approvalRequestId) await markApprovalExecuted(approvalRequestId, actor.id);

  await writeAudit({ action: "LEGAL_HOLD_RELEASE_EXECUTED", adminId: actor.id, targetProfileId: hold.profileId, meta: { holdId } });
  return hold;
}

export async function listHoldsPendingRelease() {
  return prisma.dataHold.findMany({ where: { holdStatus: "RELEASE_PENDING" }, orderBy: { placedAt: "asc" } });
}

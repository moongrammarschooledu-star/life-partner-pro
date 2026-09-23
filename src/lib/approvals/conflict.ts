import { prisma } from "@/lib/prisma";
import { getCurrentAssigneeId } from "@/lib/admin-assignment";
import { hasBroadRecordAccess } from "@/lib/permissions";
import type { ApprovalConflictType } from "@prisma/client";

// STEP 19 §29 — conflict-of-interest detection. Runs BEFORE any decision
// (approve/reject/request-changes) is recorded; a detected conflict blocks
// the action entirely and is logged to ApprovalConflict, with only a neutral
// message ever shown to the actor (the real reason stays in the audit trail
// for a Super Admin to review). SELF_APPROVAL is checked first and
// unconditionally — it can never be configured away by any policy.
export async function detectConflict(approvalRequestId: string, actorId: string): Promise<ApprovalConflictType | null> {
  const request = await prisma.approvalRequest.findUnique({ where: { id: approvalRequestId } });
  if (!request) return null;

  // 1. Maker = Approver (spec §29 bullet 1) — unconditional, no exemption.
  if (request.makerId === actorId) return "SELF_APPROVAL";

  // 2/3. Assigned staff = Approver where prohibited / Staff assigned to the
  // record = checker where policy prohibits (spec §29 bullets 2-3, merged —
  // both describe the same underlying conflict: the person already doing the
  // work cannot also be the independent second set of eyes on it, unless
  // they hold a broad/manager-tier role that already implies oversight
  // authority, mirroring assertNotSelfReviewed()'s exemption for broad roles).
  const assigneeId = await getCurrentAssigneeId(request.sourceType, request.sourceId);
  if (assigneeId && assigneeId === actorId) {
    const actor = await prisma.adminUser.findUnique({ where: { id: actorId }, select: { role: true } });
    if (actor && !hasBroadRecordAccess(actor.role)) return "ASSIGNED_STAFF_CONFLICT";
  }

  // 4. Financial requester = refund approver (spec §29 bullet 4) — the
  // underlying Refund's requestedById can never be the same admin deciding
  // this approval, mirroring refund.ts's own approveRefund() guard.
  if (request.sourceType === "PAYMENT") {
    const refund = await prisma.refund.findUnique({ where: { id: request.sourceId }, select: { requestedById: true } });
    if (refund && refund.requestedById === actorId) return "FINANCIAL_REQUESTER_CONFLICT";
  }

  // 5. Verification maker = verification approver (spec §29 bullet 5) —
  // mirrors the verification route's assertNotSelfReviewed(), but here it is
  // unconditional (no broad-role exemption): a checker on a formal governed
  // approval must always be someone other than whoever last reviewed it.
  if (request.sourceType === "VERIFICATION") {
    const verification = await prisma.profileVerification.findUnique({ where: { id: request.sourceId }, select: { lastReviewedById: true } });
    if (verification?.lastReviewedById && verification.lastReviewedById === actorId) return "VERIFICATION_MAKER_CONFLICT";
  }

  return null;
}

// Records a blocked attempt (spec §29's "Create audit event") without ever
// exposing the real conflictType to the actor — callers show only the
// neutral message: "You are not authorized to approve this request because
// separation-of-duty rules apply."
export async function recordConflict(approvalRequestId: string, actorId: string, conflictType: ApprovalConflictType): Promise<void> {
  await prisma.approvalConflict.create({ data: { approvalRequestId, actorId, conflictType } });
}

export const CONFLICT_NEUTRAL_MESSAGE = "You are not authorized to approve this request because separation-of-duty rules apply.";

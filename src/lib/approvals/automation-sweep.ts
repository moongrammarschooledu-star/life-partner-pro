import { prisma } from "@/lib/prisma";
import { expireApprovalRequest } from "@/lib/approvals/engine";
import { notifyApprovalExpiring } from "@/lib/notifications/events";
import { ACTIVE_APPROVAL_STATUSES } from "@/lib/approvals/status";

// STEP 19 §24/§43 — runs once per day inside runDailyTick() (see
// src/lib/ops/scheduler.ts), mirroring src/lib/workflow/automation-sweep.ts's
// exact shape. An expired approval request is moved to EXPIRED (never
// executed — the maker must resubmit) and one "expiring soon" notification
// is sent to the assigned checker (or broadcast) inside a configurable
// warning window before that.
const EXPIRING_SOON_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function runApprovalAutomationSweep(): Promise<{ expired: number; expiringSoonNotified: number }> {
  const now = new Date();

  const openRequests = await prisma.approvalRequest.findMany({
    where: { status: { in: ACTIVE_APPROVAL_STATUSES }, expiresAt: { not: null } },
    select: { id: true, expiresAt: true, assignedCheckerId: true, approvalCode: true, actionType: true },
  });

  let expired = 0;
  let expiringSoonNotified = 0;

  for (const request of openRequests) {
    if (!request.expiresAt) continue;
    if (request.expiresAt.getTime() <= now.getTime()) {
      await expireApprovalRequest(request.id);
      expired++;
    } else if (request.expiresAt.getTime() - now.getTime() <= EXPIRING_SOON_WINDOW_MS) {
      await notifyApprovalExpiring(request.assignedCheckerId, request.approvalCode, request.actionType);
      expiringSoonNotified++;
    }
  }

  return { expired, expiringSoonNotified };
}

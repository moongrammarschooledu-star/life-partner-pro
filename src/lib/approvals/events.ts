import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import type { AuditAction } from "@prisma/client";

// STEP 19 architecture decision 5 — a fast, purpose-built ApprovalEvent
// timeline row and the central AuditLog entry are always created together by
// this one function, so they can never drift apart (same "created together,
// can't drift apart" convention as src/lib/admin-tasks.ts's original
// task+notification comment). ApprovalEvent backs the Approval Detail page's
// on-page timeline (cheap to query by approvalRequestId); writeAudit() feeds
// the existing audit/reports infrastructure every other step already uses.
export async function recordApprovalEvent(params: {
  approvalRequestId: string;
  actorId?: string | null;
  eventType: AuditAction;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.approvalEvent.create({
    data: {
      approvalRequestId: params.approvalRequestId,
      actorId: params.actorId ?? null,
      eventType: params.eventType,
      metadata: params.metadata ? JSON.parse(JSON.stringify(params.metadata)) : undefined,
    },
  });
  await writeAudit({
    action: params.eventType,
    adminId: params.actorId ?? null,
    meta: { approvalRequestId: params.approvalRequestId, ...params.metadata },
  });
}

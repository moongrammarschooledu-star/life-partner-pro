import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { delegateApproval } from "@/lib/approvals/engine";
import { requireReason } from "@/lib/ops/admin-route";

// STEP 19 §27 — "delegate my decision on this approval to another admin,"
// scoped to this request's own actionType and expiring no later than the
// request itself. Reconciles spec §27's general time-limited delegation
// schema with §34's per-request /:id/delegate endpoint: this route is the
// per-request entry point, backed by the same general ApprovalDelegation
// engine.delegateApproval() uses for a standing grant.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("approvals:delegate");
    const { id } = await params;
    const body = (await req.json()) as { delegateId?: string; reason?: string };
    if (!body.delegateId) throw new ApiError(400, "delegateId is required.");
    const reason = requireReason(body.reason, 5);

    const request = await prisma.approvalRequest.findUnique({ where: { id }, select: { actionType: true, expiresAt: true } });
    if (!request) throw new ApiError(404, "Approval request not found.");

    const delegation = await delegateApproval({
      delegatorId: admin.id,
      delegateId: body.delegateId,
      allowedActionTypes: [request.actionType],
      startAt: new Date(),
      endAt: request.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
      reason,
      createdById: admin.id,
    });

    return NextResponse.json(delegation);
  } catch (error) {
    return handleApiError(error);
  }
}

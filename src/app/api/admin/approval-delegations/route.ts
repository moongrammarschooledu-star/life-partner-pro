import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { delegateApproval } from "@/lib/approvals/engine";
import { requireReason } from "@/lib/ops/admin-route";

// STEP 19 §27 — a standing, time-limited decision-delegation grant (as
// opposed to the per-request /api/admin/approvals/:id/delegate). Lists the
// caller's own delegations given/received; broad roles see all.
export async function GET() {
  try {
    const admin = await requireAdmin("approvals:delegate");
    const items = await prisma.approvalDelegation.findMany({
      where: { OR: [{ delegatorId: admin.id }, { delegateId: admin.id }] },
      orderBy: { createdAt: "desc" },
      include: { delegator: { select: { id: true, name: true } }, delegate: { select: { id: true, name: true } } },
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("approvals:delegate");
    const body = (await req.json()) as { delegateId?: string; allowedActionTypes?: string[]; startAt?: string; endAt?: string; reason?: string };
    if (!body.delegateId) throw new ApiError(400, "delegateId is required.");
    if (!body.startAt || !body.endAt) throw new ApiError(400, "startAt and endAt are required.");
    const reason = requireReason(body.reason, 10);

    const delegation = await delegateApproval({
      delegatorId: admin.id,
      delegateId: body.delegateId,
      allowedActionTypes: body.allowedActionTypes ?? [],
      startAt: new Date(body.startAt),
      endAt: new Date(body.endAt),
      reason,
      createdById: admin.id,
    });
    return NextResponse.json(delegation);
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { recordDecision } from "@/lib/approvals/engine";
import { requireReason } from "@/lib/ops/admin-route";

// STEP 19 §22 — rejection requires a written reason; the underlying action
// is never executed (recordDecision() moves the request straight to
// REJECTED, which has no path into EXECUTION_PENDING/EXECUTED).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("approvals:reject");
    const { id } = await params;
    const body = (await req.json()) as { reason?: string };
    const reason = requireReason(body.reason, 5);

    const updated = await recordDecision({ approvalRequestId: id, actorId: admin.id, decision: "REJECT", reason });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

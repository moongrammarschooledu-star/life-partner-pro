import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { reviewDeletionRequest } from "@/lib/privacy/deletion-request";

// Spec §14 step 5-6 — admin review. "decision: approve" schedules execution
// (a cooling-off period, default 7 days) rather than deleting immediately;
// "decision: reject" reverts the account to ACTIVE.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("privacy:delete:manage");
    const { id } = await params;
    const { decision, mode, rejectionReason, coolingOffDays } = await req.json();

    if (decision !== "approve" && decision !== "reject") throw new Error("decision must be 'approve' or 'reject'.");

    const updated = await reviewDeletionRequest({ requestId: id, adminId: admin.id, decision, mode, rejectionReason, coolingOffDays });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

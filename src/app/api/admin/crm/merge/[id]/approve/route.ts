import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { requireReason, requireReauth } from "@/lib/ops/admin-route";
import { getApprovalPolicy } from "@/lib/approvals/policy-engine";
import { recordDecision } from "@/lib/approvals/engine";
import { executeMerge } from "@/lib/crm/merge-service";

// STEP 28 §39 — the "[id]/approve" thin wrapper the plan calls for: [id] is
// the DuplicateCluster id. It reuses the EXISTING approval decision engine
// (src/lib/approvals/engine.ts's recordDecision — same conflict-of-interest/
// policy checks /api/admin/approvals/[id]/approve applies) and, once the
// DUPLICATE_MERGE request is APPROVED, calls the genuinely new executeMerge().
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("crm:merge:approve");
    const { id: clusterId } = await params;
    const body = (await req.json().catch(() => ({}))) as { reason?: unknown; reauthToken?: string };
    const reason = requireReason(body.reason, 5);

    const approval = await prisma.approvalRequest.findFirst({
      where: { actionType: "DUPLICATE_MERGE", sourceType: "PROFILE", requestedPayload: { path: ["clusterId"], equals: clusterId } },
      orderBy: { createdAt: "desc" },
    });
    if (!approval) throw new ApiError(404, "No merge approval request exists for this cluster. Request one first.");

    const policy = await getApprovalPolicy("DUPLICATE_MERGE");
    if (policy?.reauthRequired) requireReauth(admin, body.reauthToken, "approve this merge");

    await recordDecision({ approvalRequestId: approval.id, actorId: admin.id, decision: "APPROVE", reason });
    const result = await executeMerge(clusterId, admin, reason);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

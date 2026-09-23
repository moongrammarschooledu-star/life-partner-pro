import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { recordDecision } from "@/lib/approvals/engine";
import { getApprovalPolicy } from "@/lib/approvals/policy-engine";
import { requireReauth } from "@/lib/ops/admin-route";
import { prisma } from "@/lib/prisma";

const APPROVE_PERMISSIONS = ["approvals:approve", "finance:approval:approve", "privacy:approval:approve", "security:approval:approve", "ai:approval:approve", "sensitive:approval:approve"] as const;

// STEP 19 §5/§21 — coarse route-level gate (must hold at least one of the
// approval permissions); the actual per-request eligibility (role in the
// policy's allowedRoles, not the maker, no conflict of interest, quorum)
// is enforced entirely inside recordDecision()/policy-engine.ts. A policy
// flagged reauthRequired additionally demands fresh password confirmation
// before a decision this sensitive is recorded.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    if (!APPROVE_PERMISSIONS.some((p) => admin.permissions.includes(p))) {
      throw new ApiError(403, "Forbidden: insufficient permissions");
    }
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { reason?: string; reauthToken?: string };

    const request = await prisma.approvalRequest.findUnique({ where: { id }, select: { actionType: true } });
    if (!request) throw new ApiError(404, "Approval request not found.");
    const policy = await getApprovalPolicy(request.actionType);
    if (policy?.reauthRequired) requireReauth(admin, body.reauthToken, "approve this request");

    const updated = await recordDecision({ approvalRequestId: id, actorId: admin.id, decision: "APPROVE", reason: body.reason });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

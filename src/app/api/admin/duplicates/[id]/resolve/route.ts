import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { resolveDuplicateCandidate } from "@/lib/verification/account-relationships";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";

const VALID_DECISIONS = ["CONFIRMED_DUPLICATE", "NOT_DUPLICATE"] as const;

// Confirming a duplicate is the one high-risk decision here — gated through
// STEP 19 exactly like every other high-risk action (spec §20). Dismissing
// as NOT_DUPLICATE is not gated: it revokes no access and grants no elevated
// trust, it's the "nothing happens" outcome.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("duplicates:resolve");
    const { id } = await params;
    const { decision, resolution } = (await req.json()) as { decision?: string; resolution?: string };

    if (!decision || !VALID_DECISIONS.includes(decision as (typeof VALID_DECISIONS)[number])) {
      throw new ApiError(400, "A valid decision (CONFIRMED_DUPLICATE or NOT_DUPLICATE) is required.");
    }
    if (!resolution?.trim()) throw new ApiError(400, "A resolution note is required.");

    const candidate = await prisma.duplicateCandidate.findUnique({ where: { id } });
    if (!candidate) throw new ApiError(404, "Duplicate candidate not found");

    if (decision === "CONFIRMED_DUPLICATE") {
      const gate = await enforceApprovalGate({
        actionType: "DUPLICATE_CONFIRMATION",
        sourceType: "SECURITY_FLAG",
        sourceId: candidate.securityFlagId ?? candidate.id,
        actor: admin,
        reason: resolution.trim(),
        requestedPayload: { candidateId: id, profileId: candidate.profileId, candidateProfileId: candidate.candidateProfileId },
      });
      if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") {
        return NextResponse.json({ approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status }, { status: 202 });
      }

      const result = await resolveDuplicateCandidate(id, { adminId: admin.id, decision: "CONFIRMED_DUPLICATE", resolution: resolution.trim() });
      if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, admin.id);
      return NextResponse.json(result);
    }

    const result = await resolveDuplicateCandidate(id, { adminId: admin.id, decision: "NOT_DUPLICATE", resolution: resolution.trim() });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}

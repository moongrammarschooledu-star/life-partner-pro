import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { prisma } from "@/lib/prisma";
import { liftHold } from "@/lib/privacy/data-hold";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import { str } from "@/lib/documents/route-utils";

// Releasing a document legal hold is gated by the STEP 19 approval flow (spec §54 — "unless an authorized
// legal/compliance workflow releases the hold"), unlike placing one.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("documents:manage_legal_hold");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const holdId = str(body.holdId, "holdId", { max: 60 });
    const hold = await prisma.dataHold.findUnique({ where: { id: holdId } });
    if (!hold || hold.recordType !== "Document" || hold.recordId !== id || !hold.active) throw new ApiError(404, "Active hold not found for this document.");

    const gate = await enforceApprovalGate({ actionType: "DOCUMENT_LEGAL_HOLD_RELEASE", sourceType: "DOCUMENT", sourceId: id, actor: admin, reason: str(body.reason, "reason", { max: 500 }), requestedPayload: { holdId, documentId: id } });
    if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return NextResponse.json({ approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status }, { status: 202 });
    if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, admin.id);

    const lifted = await liftHold(holdId, admin.id);
    return NextResponse.json({ approvalRequired: false, hold: lifted });
  } catch (error) {
    return handleApiError(error);
  }
}

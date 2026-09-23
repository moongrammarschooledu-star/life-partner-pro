import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { recordDecision } from "@/lib/approvals/engine";
import { requireReason } from "@/lib/ops/admin-route";

// STEP 19 §23 — the checker asks the maker for changes; a material change
// (any resubmission after this) invalidates prior progress, enforced inside
// recordDecision()'s REQUEST_CHANGES branch (resets every reviewer decision
// and bumps version).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("approvals:request-changes");
    const { id } = await params;
    const body = (await req.json()) as { reason?: string };
    const reason = requireReason(body.reason, 5);

    const updated = await recordDecision({ approvalRequestId: id, actorId: admin.id, decision: "REQUEST_CHANGES", reason });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

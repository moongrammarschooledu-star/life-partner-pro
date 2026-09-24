import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertProposalAccess } from "@/lib/proposal-access";
import { applyContactPermissionAction, ProposalPermissionError } from "@/lib/proposal-permissions";

// Per-profile consent state for a proposal (spec §8) — distinct from
// ContactShareLog, which records the actual reveal once both sides here are
// approved. This intentionally does NOT block the existing reveal endpoint
// server-side (see /api/admin/profiles/[id]/contact) so Step 1-6 behavior
// stays unchanged; the Proposal Detail UI shows a warning banner instead
// when reveal is attempted before both permissions are approved.
// State-machine logic lives in src/lib/proposal-permissions.ts (STEP 21) —
// extracted so the applicant self-service route reuses it unchanged.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("proposal:edit");
    const { id } = await params;
    const { profileId, action } = await req.json(); // action: "request" | "approve" | "revoke"

    const proposal = await prisma.proposal.findUnique({ where: { id } });
    if (!proposal) throw new ApiError(404, "Proposal not found");
    assertProposalAccess(admin, proposal);

    const result = await applyContactPermissionAction({ proposalId: id, profileId, action, actor: { type: "admin", adminId: admin.id } });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProposalPermissionError) return NextResponse.json({ error: error.message }, { status: error.status });
    return handleApiError(error);
  }
}

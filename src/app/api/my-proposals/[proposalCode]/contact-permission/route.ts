import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { applyContactPermissionAction, ProposalPermissionError } from "@/lib/proposal-permissions";

// STEP 21 Decision 3 — applicant self-service grant/revoke of their OWN
// ContactPermission row for this proposal, reusing the exact admin state
// machine (src/lib/proposal-permissions.ts). profileId is always the
// session's own id — never trusted from the request body — so an applicant
// can never act on the other party's row.
export async function POST(req: Request, { params }: { params: Promise<{ proposalCode: string }> }) {
  const key = `my-proposals-contact-permission:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 20, 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
  }

  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { proposalCode } = await params;
  const { action } = await req.json(); // "grant" | "revoke"
  if (action !== "grant" && action !== "revoke") {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const proposal = await prisma.proposal.findUnique({ where: { proposalCode: proposalCode.trim().toUpperCase() } });
  if (!proposal || (proposal.profileAId !== profileId && proposal.profileBId !== profileId)) {
    return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
  }

  try {
    const result = await applyContactPermissionAction({
      proposalId: proposal.id,
      profileId,
      action: action === "grant" ? "approve" : "revoke",
      actor: { type: "applicant" },
    });
    return NextResponse.json({ bothApproved: result.bothApproved });
  } catch (error) {
    if (error instanceof ProposalPermissionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

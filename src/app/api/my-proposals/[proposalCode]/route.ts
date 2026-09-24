import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { buildProposalDetailForProfile } from "@/lib/visibility/proposal-visibility";

// STEP 21 — proposal detail view (the list-only /api/my-proposals had no
// per-proposal drill-down). Returns null identically for "no such proposal"
// and "proposal exists but isn't mine" — no enumeration signal.
export async function GET(_req: Request, { params }: { params: Promise<{ proposalCode: string }> }) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { proposalCode } = await params;
  const detail = await buildProposalDetailForProfile(profileId, proposalCode);
  if (!detail) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });

  return NextResponse.json(detail);
}

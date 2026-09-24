import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { buildProposalListForProfile } from "@/lib/visibility/proposal-visibility";

// Deliberately narrow (spec §5/§26): never contact info, admin notes,
// internal rejection notes, staff identity, raw per-category numeric
// scores, or the other profile's photos. Mirrors /api/my-status's
// cookie-verification pattern exactly — re-checks the profile still exists
// and isn't soft-deleted rather than trusting the cookie payload alone.
// Narrowing logic lives in src/lib/visibility/proposal-visibility.ts (STEP
// 21 ProposalVisibilityService) — extracted from this route unchanged.
export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const items = await buildProposalListForProfile(profileId);
  return NextResponse.json({ items });
}

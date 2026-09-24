import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { runApplicantProfileImprovement } from "@/lib/ai/applicant-features";
import { blockedResponse } from "@/lib/ops/guards";

// STEP 21 — the one applicant-facing AI feature (Decision 8). Rule-based
// only, never calls an external provider, never processes another
// profile's data. See src/lib/ai/applicant-features.ts for the full scope
// disclosure and safety/consent gating.
export async function POST() {
  const blocked = await blockedResponse({ flags: ["ai.enabled", "ai.profile_summary.enabled"] });
  if (blocked) return blocked;

  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const outcome = await runApplicantProfileImprovement(profileId);
  if (!outcome.ok) return NextResponse.json({ error: outcome.message, code: outcome.code }, { status: outcome.status });

  return NextResponse.json({ payload: outcome.payload, labels: outcome.labels, requestId: outcome.requestId });
}

import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { buildSelfProfileView } from "@/lib/visibility/user-data-visibility";

// STEP 21 — "My Profile" full self-view. No redaction (the viewer IS the
// data owner) — see src/lib/visibility/user-data-visibility.ts.
export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const view = await buildSelfProfileView(profileId);
  if (!view) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json(view);
}

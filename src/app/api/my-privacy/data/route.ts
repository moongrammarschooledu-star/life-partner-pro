import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { buildDataExportPayload } from "@/lib/privacy/data-export";

// Spec §9 "My Data" tab — reuses the same hand-picked field set as the data
// export (never internal notes, security flags, or other profiles' data),
// just rendered for on-page viewing instead of downloading.
export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const data = await buildDataExportPayload(profileId);
  return NextResponse.json(data);
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { revokeOtherProfileSessions } from "@/lib/profile-session";
import { verifySessionIdToken, APPLICANT_SESSION_ID_COOKIE } from "@/lib/applicant-session";

export async function POST() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const cookieStore = await cookies();
  const currentSessionId = verifySessionIdToken(cookieStore.get(APPLICANT_SESSION_ID_COOKIE)?.value) ?? undefined;

  const count = await revokeOtherProfileSessions(profileId, currentSessionId);
  return NextResponse.json({ ok: true, revoked: count });
}

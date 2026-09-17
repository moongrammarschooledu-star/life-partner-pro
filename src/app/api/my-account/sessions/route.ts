import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { listProfileSessions } from "@/lib/profile-session";
import { verifySessionIdToken, APPLICANT_SESSION_ID_COOKIE } from "@/lib/applicant-session";
import { cookies } from "next/headers";

export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const cookieStore = await cookies();
  const currentSessionId = verifySessionIdToken(cookieStore.get(APPLICANT_SESSION_ID_COOKIE)?.value);

  const sessions = await listProfileSessions(profileId);
  return NextResponse.json({
    items: sessions.map((s) => ({
      id: s.id,
      deviceInfo: s.deviceInfo,
      ipAddress: s.ipAddress,
      lastActiveAt: s.lastActiveAt,
      createdAt: s.createdAt,
      isCurrent: s.id === currentSessionId,
    })),
  });
}

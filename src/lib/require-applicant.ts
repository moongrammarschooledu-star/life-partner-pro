import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyProfileToken, verifySessionIdToken, APPLICANT_COOKIE, APPLICANT_SESSION_ID_COOKIE } from "@/lib/applicant-session";
import { touchAndValidateSession } from "@/lib/profile-session";

// Shared helper for every /api/my-*, /api/my-cases/*, /api/my-account/*, and
// /api/my-privacy/* route (STEP 13 migrated the remaining routes that used
// to inline this check onto this single function — see the plan's decision
// 9: a "revoke this session" feature is meaningless unless every
// applicant-facing route actually checks revocation).
export async function requireApplicantProfileId(): Promise<string | null> {
  const cookieStore = await cookies();
  const profileId = verifyProfileToken(cookieStore.get(APPLICANT_COOKIE)?.value);
  if (!profileId) return null;

  const me = await prisma.profile.findUnique({ where: { id: profileId }, select: { id: true, softDeleted: true } });
  if (!me || me.softDeleted) return null;

  // A browser with no session cookie yet (pre-STEP-13) is grandfathered
  // through session-less rather than logged out — the next /api/my-status
  // login provisions one. Once present, it must be valid.
  const sessionId = verifySessionIdToken(cookieStore.get(APPLICANT_SESSION_ID_COOKIE)?.value);
  if (sessionId) {
    const valid = await touchAndValidateSession(sessionId, profileId);
    if (!valid) return null;
  }

  return profileId;
}

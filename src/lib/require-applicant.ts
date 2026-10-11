import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyProfileToken, verifySessionIdToken, APPLICANT_COOKIE, APPLICANT_SESSION_ID_COOKIE } from "@/lib/applicant-session";
import { touchAndValidateSession } from "@/lib/profile-session";
import { hasActiveRestriction } from "@/lib/profile-restrictions";

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

  // STEP 23 §11/§27 — a LOGIN_RESTRICTED restriction locks the applicant out
  // of every /api/my-*, /api/my-cases/*, /api/my-account/*, and
  // /api/my-privacy/* route that funnels through this one check.
  // STEP 24 — FULL_ACCOUNT_RESTRICTED is the same lock, applied as a broader risk-driven restriction.
  if ((await hasActiveRestriction(profileId, "LOGIN_RESTRICTED")) || (await hasActiveRestriction(profileId, "FULL_ACCOUNT_RESTRICTED"))) return null;

  const sessionId = verifySessionIdToken(cookieStore.get(APPLICANT_SESSION_ID_COOKIE)?.value);
  // STEP 33 — the session cookie is REQUIRED. The old rule let a browser holding only the long-lived signed profile cookie straight in, which
  // meant revoking a session (or "sign out everywhere") could be sidestepped by simply dropping the session-id cookie. Every sign-in since
  // STEP 13 sets both cookies, so nobody legitimate is affected: a very old browser just signs in again.
  if (!sessionId) return null;
  const valid = await touchAndValidateSession(sessionId, profileId);
  if (!valid) return null;

  return profileId;
}

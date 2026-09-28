import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyFamilySessionIdToken, FAMILY_SESSION_ID_COOKIE } from "@/lib/family/family-session";
import { touchAndValidateFamilyMemberSession } from "@/lib/family/family-member-session";
import { hasActiveRestriction } from "@/lib/profile-restrictions";

// The canonical guard every /api/family/* route must call — mirrors
// requireApplicantProfileId()'s pattern exactly. Returns null (never a
// thrown exception) for "not signed in," "session expired/revoked," or
// "account suspended/removed" alike, so callers can't distinguish these
// from a route-authorization standpoint (defense in depth beyond the
// session-revocation-on-status-change invariant in access-control.ts).
export async function requireFamilyMemberId(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionId = verifyFamilySessionIdToken(cookieStore.get(FAMILY_SESSION_ID_COOKIE)?.value);
  if (!sessionId) return null;

  const familyMemberId = await touchAndValidateFamilyMemberSession(sessionId);
  if (!familyMemberId) return null;

  const member = await prisma.familyMember.findUnique({
    where: { id: familyMemberId },
    select: { status: true, familyAccount: { select: { applicantId: true } } },
  });
  if (!member || member.status !== "ACTIVE") return null;

  // STEP 23 §11/§27 — a LOGIN_RESTRICTED restriction on the applicant's own
  // profile locks out the whole family account, not just the applicant's
  // own session; a restricted applicant is not a channel to route around via
  // a delegated family login.
  if ((await hasActiveRestriction(member.familyAccount.applicantId, "LOGIN_RESTRICTED")) || (await hasActiveRestriction(member.familyAccount.applicantId, "FULL_ACCOUNT_RESTRICTED"))) return null;

  return familyMemberId;
}

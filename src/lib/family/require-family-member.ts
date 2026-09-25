import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyFamilySessionIdToken, FAMILY_SESSION_ID_COOKIE } from "@/lib/family/family-session";
import { touchAndValidateFamilyMemberSession } from "@/lib/family/family-member-session";

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

  const member = await prisma.familyMember.findUnique({ where: { id: familyMemberId }, select: { status: true } });
  if (!member || member.status !== "ACTIVE") return null;

  return familyMemberId;
}

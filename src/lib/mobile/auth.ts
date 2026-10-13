import { cookies } from "next/headers";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";
import { APPLICANT_SESSION_ID_COOKIE, verifySessionIdToken } from "@/lib/applicant-session";
import { FAMILY_SESSION_ID_COOKIE, verifyFamilySessionIdToken } from "@/lib/family/family-session";

// Who is calling a mobile endpoint. The apps use the SAME cookie sessions as the website (the web view keeps them), so there is no second token system:
// the existing guards validate the session, its revocation, restrictions and account status. This only reads which session it was.

export type MobileActor =
  | { kind: "PROFILE"; profileId: string; sessionId: string }
  | { kind: "FAMILY"; familyMemberId: string; sessionId: string };

export async function requireMobileActor(): Promise<MobileActor | null> {
  const jar = await cookies();
  const profileId = await requireApplicantProfileId();
  if (profileId) {
    const sessionId = verifySessionIdToken(jar.get(APPLICANT_SESSION_ID_COOKIE)?.value);
    return sessionId ? { kind: "PROFILE", profileId, sessionId } : null;
  }
  const familyMemberId = await requireFamilyMemberId();
  if (familyMemberId) {
    const sessionId = verifyFamilySessionIdToken(jar.get(FAMILY_SESSION_ID_COOKIE)?.value);
    return sessionId ? { kind: "FAMILY", familyMemberId, sessionId } : null;
  }
  return null;
}

export const ownerWhere = (a: MobileActor) => (a.kind === "PROFILE" ? { profileId: a.profileId } : { familyMemberId: a.familyMemberId });
export const actorIds = (a: MobileActor) => (a.kind === "PROFILE" ? { profileId: a.profileId, familyMemberId: null } : { profileId: null, familyMemberId: a.familyMemberId });
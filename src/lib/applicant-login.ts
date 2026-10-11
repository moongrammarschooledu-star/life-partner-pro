import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { clientKeyFromRequest } from "@/lib/rate-limit";
import { signProfileToken, signSessionId, APPLICANT_COOKIE, APPLICANT_SESSION_ID_COOKIE } from "@/lib/applicant-session";
import { createProfileSession } from "@/lib/profile-session";
import { publishSecurityEvent } from "@/lib/security/event-bus";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { hasActiveRestriction } from "@/lib/profile-restrictions";

// Shared by the two steps of an applicant sign-in (STEP 33):
//   1. POST /api/my-status         Profile ID + e-mail address  -> (flag ON) a one-time code is e-mailed, nothing is signed in
//   2. POST /api/my-status/verify  Profile ID + e-mail + code   -> the session cookies are set
// A Profile ID and an e-mail address are identifiers other people can know (the Profile ID is even shown to the other party of a
// proposal), so on their own they are not a credential; the code, readable only in the mailbox, is.

export const OTP_LOGIN_FLAG = "auth.applicant_otp_login.enabled";

export async function otpLoginRequired(): Promise<boolean> {
  return isFeatureEnabled(OTP_LOGIN_FLAG);
}

export interface LoginProfile {
  id: string;
  profileCode: string;
  status: string;
  verified: boolean;
  profileCompletion: number;
  createdAt: Date;
  contact: { email: string };
}

// Finds the profile only when BOTH identifiers match; every other outcome is the same "no match" so nothing reveals which part was wrong.
export async function findProfileForLogin(profileCode: unknown, email: unknown): Promise<LoginProfile | null> {
  if (typeof profileCode !== "string" || typeof email !== "string" || profileCode.length > 40 || email.length > 254) return null;
  const profile = await prisma.profile.findUnique({
    where: { profileCode: profileCode.trim().toUpperCase() },
    select: { id: true, profileCode: true, status: true, verified: true, profileCompletion: true, createdAt: true, softDeleted: true, contact: { select: { email: true } } },
  });
  if (!profile || profile.softDeleted || !profile.contact) return null;
  if (profile.contact.email.toLowerCase() !== email.trim().toLowerCase()) return null;
  return { ...profile, contact: profile.contact };
}

// A restricted account is refused at every later request too (requireApplicantProfileId); refusing it here keeps a code from being mailed
// for an account that could not use it.
export async function isLoginRestricted(profileId: string): Promise<boolean> {
  return (await hasActiveRestriction(profileId, "LOGIN_RESTRICTED")) || (await hasActiveRestriction(profileId, "FULL_ACCOUNT_RESTRICTED"));
}

export function loginStatusPayload(profile: Pick<LoginProfile, "profileCode" | "status" | "verified" | "profileCompletion" | "createdAt">) {
  return { profileCode: profile.profileCode, status: profile.status, verified: profile.verified, profileCompletion: profile.profileCompletion, createdAt: profile.createdAt };
}

export async function publishFailedLogin(req: Request, profile: { id: string } | null, profileCode: unknown, outcome: string) {
  await publishSecurityEvent({
    eventType: "LOGIN_FAILED",
    profileId: profile?.id ?? null,
    subject: typeof profileCode === "string" ? profileCode.trim().toUpperCase().slice(0, 40) : undefined,
    ip: clientKeyFromRequest(req),
    source: "applicant-login",
    outcome,
  });
}

// Sets the two cookies and opens the server-side session row. The caller has already proven who the person is.
export async function startApplicantSession(req: Request, profileId: string) {
  const cookieStore = await cookies();
  const options = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, maxAge: 60 * 60 * 24 * 365, path: "/" };
  cookieStore.set(APPLICANT_COOKIE, signProfileToken(profileId), options);
  const session = await createProfileSession(profileId, undefined, req.headers.get("user-agent") ?? undefined, clientKeyFromRequest(req));
  cookieStore.set(APPLICANT_SESSION_ID_COOKIE, signSessionId(session.id), options);
}

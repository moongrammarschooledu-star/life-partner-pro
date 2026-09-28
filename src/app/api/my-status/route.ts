import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { clientKeyFromRequest } from "@/lib/rate-limit";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { signProfileToken, signSessionId, APPLICANT_COOKIE, APPLICANT_SESSION_ID_COOKIE } from "@/lib/applicant-session";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { createProfileSession } from "@/lib/profile-session";
import { publishSecurityEvent } from "@/lib/security/event-bus";

// Deliberately narrow: status/verification/completion only, never contact,
// income, family, photo, or partner-preference data (spec §18/§34) — this is
// the "User Private Information" tier, not the "Admin-Only" one.
function statusPayload(profile: { profileCode: string; status: string; verified: boolean; profileCompletion: number; createdAt: Date }) {
  return {
    profileCode: profile.profileCode,
    status: profile.status,
    verified: profile.verified,
    profileCompletion: profile.profileCompletion,
    createdAt: profile.createdAt,
  };
}

export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { profileCode: true, status: true, verified: true, profileCompletion: true, createdAt: true, softDeleted: true },
  });
  if (!profile || profile.softDeleted) return NextResponse.json({ error: "Not found." }, { status: 401 });

  return NextResponse.json(statusPayload(profile));
}

export async function POST(req: Request) {
  const limited = await enforceConfiguredLimit(req, "my-status", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  try {
    const { profileCode, email } = await req.json();
    if (typeof profileCode !== "string" || typeof email !== "string") {
      return NextResponse.json({ error: "Profile ID and email are required." }, { status: 400 });
    }

    const profile = await prisma.profile.findUnique({
      where: { profileCode: profileCode.trim().toUpperCase() },
      include: { contact: true },
    });
    if (!profile || profile.softDeleted || !profile.contact || profile.contact.email.toLowerCase() !== email.trim().toLowerCase()) {
      // STEP 24 — a failed sign-in attempt. Attributed to the profile when the code exists (so repeated
      // guessing against ONE account is visible), never revealing to the caller whether it does.
      await publishSecurityEvent({ eventType: "LOGIN_FAILED", profileId: profile && !profile.softDeleted ? profile.id : null, subject: profileCode.trim().toUpperCase(), ip: clientKeyFromRequest(req), source: "applicant-login", outcome: "NO_MATCH" });
      return NextResponse.json({ error: "We could not find a profile matching that Profile ID and email." }, { status: 404 });
    }

    const cookieStore = await cookies();
    cookieStore.set(APPLICANT_COOKIE, signProfileToken(profile.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });

    const session = await createProfileSession(profile.id, undefined, req.headers.get("user-agent") ?? undefined, clientKeyFromRequest(req));
    cookieStore.set(APPLICANT_SESSION_ID_COOKIE, signSessionId(session.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });

    return NextResponse.json(statusPayload(profile));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

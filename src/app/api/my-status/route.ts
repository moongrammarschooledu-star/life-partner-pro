import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { findProfileForLogin, isLoginRestricted, loginStatusPayload, otpLoginRequired, publishFailedLogin, startApplicantSession } from "@/lib/applicant-login";
import { NoCodeChannelError, sendContactCode } from "@/lib/verification/contact-code";
import { rateLimitPersistent, tooManyRequests } from "@/lib/ops/rate-limit-persistent";

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
    let body: { profileCode?: unknown; email?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: "Profile ID and your mobile number or e-mail are required." }, { status: 400 });
    }
    const { profileCode, email } = body;
    if (typeof profileCode !== "string" || typeof email !== "string") {
      return NextResponse.json({ error: "Profile ID and your mobile number or e-mail are required." }, { status: 400 });
    }

    const NO_MATCH = { error: "We could not find a profile matching that Profile ID and mobile number or e-mail." };
    const profile = await findProfileForLogin(profileCode, email);
    if (!profile || (await isLoginRestricted(profile.id))) {
      // STEP 24 — a failed sign-in attempt. Attributed to the profile when the code exists (so repeated guessing against ONE account is
      // visible), never revealing to the caller whether it does.
      const known = await prisma.profile.findUnique({ where: { profileCode: profileCode.trim().toUpperCase().slice(0, 40) }, select: { id: true, softDeleted: true } });
      await publishFailedLogin(req, known && !known.softDeleted ? known : null, profileCode, "NO_MATCH");
      return NextResponse.json(NO_MATCH, { status: 404 });
    }

    // STEP 33 — Profile ID + e-mail address are identifiers, not a secret. Step two of the sign-in is a one-time code sent to that address;
    // no cookie is issued here. Mails to one profile are capped (so nobody can use this to flood a mailbox) on top of the per-address limit above.
    if (await otpLoginRequired()) {
      const perProfile = await rateLimitPersistent(`applicant-login-otp:sub:${profile.id}`, 5, 60 * 60_000);
      if (!perProfile.allowed) return tooManyRequests(3600);
      try {
        // The code goes by WhatsApp, else SMS, else e-mail (whichever a real provider can deliver); the screen is told which, so it can say where to look.
        const { channel, destinationMasked } = await sendContactCode(profile.id, "LOGIN");
        return NextResponse.json({ otpRequired: true, destinationMasked, channel });
      } catch (error) {
        if (error instanceof NoCodeChannelError) return NextResponse.json({ error: "We cannot send a sign-in code right now. Please try again later or contact support." }, { status: 503 });
        throw error;
      }
    }

    await startApplicantSession(req, profile.id);
    return NextResponse.json(loginStatusPayload(profile));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

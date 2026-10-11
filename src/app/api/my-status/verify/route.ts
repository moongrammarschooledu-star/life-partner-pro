import { NextResponse } from "next/server";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { findProfileForLogin, isLoginRestricted, loginStatusPayload, publishFailedLogin, startApplicantSession } from "@/lib/applicant-login";
import { confirmLoginOtp } from "@/lib/verification/otp-service";
import { rateLimitPersistent, tooManyRequests } from "@/lib/ops/rate-limit-persistent";

// STEP 33 — step two of the applicant sign-in: Profile ID + e-mail address + the one-time code that was e-mailed in step one. Only here are
// the session cookies issued. Public by design (it IS the sign-in), so it is rate-limited per address and, below, per profile; a wrong code
// is counted atomically and a code stops working after its attempts are used.
const NOT_VALID = "That code is not valid. Please check it, or go back and ask for a new one.";

export async function POST(req: Request) {
  const limited = await enforceConfiguredLimit(req, "my-status-verify", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  try {
    let body: { profileCode?: unknown; email?: unknown; code?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: NOT_VALID }, { status: 400 });
    }
    const { profileCode, email, code } = body;
    if (typeof code !== "string" || !code.trim() || code.length > 64) return NextResponse.json({ error: NOT_VALID }, { status: 400 });

    const profile = await findProfileForLogin(profileCode, email);
    if (!profile || (await isLoginRestricted(profile.id))) {
      await publishFailedLogin(req, null, profileCode, "NO_MATCH");
      return NextResponse.json({ error: NOT_VALID }, { status: 400 });
    }

    // However the requests are spread across addresses, one profile can only be guessed at so many times.
    const perProfile = await rateLimitPersistent(`applicant-login-verify:sub:${profile.id}`, 15, 15 * 60_000);
    if (!perProfile.allowed) return tooManyRequests(900);

    const result = await confirmLoginOtp(profile.id, code);
    if (!result.ok) {
      await publishFailedLogin(req, profile, profileCode, "WRONG_CODE");
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    await startApplicantSession(req, profile.id); // the OTP_VERIFIED audit row is written by confirmLoginOtp; the session itself raises NEW_DEVICE_SESSION
    return NextResponse.json(loginStatusPayload(profile));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

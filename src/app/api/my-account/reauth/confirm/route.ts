import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { confirmOtp } from "@/lib/verification/otp-service";
import { issueApplicantReauthToken } from "@/lib/privacy/applicant-reauth";

// Step 2 — confirms the OTP and issues a short-lived reauth token the
// client attaches to the actual high-risk request (deactivate/delete/
// export), mirroring the admin step-up-reauth pattern.
export async function POST(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const limited = await enforceConfiguredLimit(req, "my-account-reauth-confirm", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const { code } = await req.json();
  if (typeof code !== "string" || !code.trim()) {
    return NextResponse.json({ error: "Enter the code you received." }, { status: 400 });
  }

  const result = await confirmOtp(profileId, "EMAIL", code);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ reauthToken: issueApplicantReauthToken(profileId) });
}

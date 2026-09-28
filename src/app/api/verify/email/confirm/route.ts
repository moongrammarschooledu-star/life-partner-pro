import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { confirmOtp } from "@/lib/verification/otp-service";

export async function POST(req: Request) {
  const limited = await enforceConfiguredLimit(req, "otp-email-confirm", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { token } = await req.json();
  if (typeof token !== "string" || !token.trim()) {
    return NextResponse.json({ error: "Enter the verification code from your email." }, { status: 400 });
  }

  const result = await confirmOtp(profileId, "EMAIL", token);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true });
}

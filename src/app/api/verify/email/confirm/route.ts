import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { confirmOtp } from "@/lib/verification/otp-service";

export async function POST(req: Request) {
  const key = `otp-email-confirm:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 10, 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
  }

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

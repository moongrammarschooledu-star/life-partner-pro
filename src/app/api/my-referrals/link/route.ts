import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { linkReferral } from "@/lib/referrals/referral-service";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";

export async function POST(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const limited = await enforceConfiguredLimit(req, "my-referrals-link", { limit: 5, windowMs: 60_000 });
  if (limited) return limited;

  const { code } = (await req.json()) as { code?: string };
  if (!code?.trim()) return NextResponse.json({ error: "A referral code is required." }, { status: 400 });

  try {
    const referral = await linkReferral(profileId, code.trim());
    return NextResponse.json({ ok: true, referralId: referral.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not link this referral code." }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { verifyApplicantReauthToken } from "@/lib/privacy/applicant-reauth";
import { deactivateAccount } from "@/lib/privacy/account-status";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";

// Spec §12 — consequences are explained client-side before this is called;
// the server enforces identity reconfirmation (reauthToken) since this is a
// high-risk change, per spec §22.
export async function POST(req: Request) {
  // STEP 15 §19 — persistent (cross-instance) rate limit.
  const limited = await enforcePersistentLimit(req, "account-deactivate", 5, 3600000);
  if (limited) return limited;
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { reauthToken } = await req.json().catch(() => ({}));
  if (!verifyApplicantReauthToken(reauthToken, profileId)) {
    return NextResponse.json({ error: "Please reconfirm your identity before continuing." }, { status: 403 });
  }

  await deactivateAccount(profileId);
  return NextResponse.json({ ok: true });
}

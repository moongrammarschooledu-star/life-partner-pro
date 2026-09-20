import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { verifyApplicantReauthToken } from "@/lib/privacy/applicant-reauth";
import { reactivateAccount } from "@/lib/privacy/account-status";
import { prisma } from "@/lib/prisma";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";

// Spec §13 — checks account status before reactivating; does not restore
// independently-set restrictions or reset consent/verification state (see
// reactivateAccount's own comment).
export async function POST(req: Request) {
  // STEP 15 §19 — persistent (cross-instance) rate limit.
  const limited = await enforcePersistentLimit(req, "account-reactivate", 10, 3600000);
  if (limited) return limited;
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { reauthToken } = await req.json().catch(() => ({}));
  if (!verifyApplicantReauthToken(reauthToken, profileId)) {
    return NextResponse.json({ error: "Please reconfirm your identity before continuing." }, { status: 403 });
  }

  const profile = await prisma.profile.findUnique({ where: { id: profileId }, select: { accountStatus: true } });
  if (profile?.accountStatus !== "DEACTIVATED") {
    return NextResponse.json({ error: "This account is not currently deactivated." }, { status: 400 });
  }

  await reactivateAccount(profileId);
  return NextResponse.json({ ok: true });
}

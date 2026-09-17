import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { recordConsent, revokeConsent, getConsentHistory, resolveEffectiveConsent } from "@/lib/privacy/consent";
import { backfillConsentGrantsForProfile } from "@/lib/privacy/consent-backfill";
import type { ConsentCategory } from "@prisma/client";

const ESSENTIAL_CATEGORIES: ConsentCategory[] = ["ACCOUNT_CREATION", "MATRIMONIAL_PROFILE_PROCESSING", "TERMS_AND_PRIVACY_POLICY"];

export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  await backfillConsentGrantsForProfile(profileId).catch(() => {});

  const [effective, history] = await Promise.all([resolveEffectiveConsent(profileId), getConsentHistory(profileId)]);
  return NextResponse.json({ effective, history: history.slice(0, 50) });
}

// Spec §8 — essential consent (account processing/terms) explains
// consequences before disabling rather than allowing silent revocation;
// optional categories revoke immediately.
export async function PATCH(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { category, status, confirmEssential } = (await req.json()) as { category?: ConsentCategory; status?: "GRANTED" | "REVOKED"; confirmEssential?: boolean };
  if (!category || !status) return NextResponse.json({ error: "category and status are required." }, { status: 400 });

  if (ESSENTIAL_CATEGORIES.includes(category) && status === "REVOKED" && !confirmEssential) {
    return NextResponse.json({ error: "This consent is required for your account to remain active. Confirm to proceed anyway." }, { status: 409 });
  }

  const grant = status === "REVOKED" ? await revokeConsent(profileId, category, "CONSENT_CENTER") : await recordConsent({ profileId, category, status: "GRANTED", source: "CONSENT_CENTER" });

  return NextResponse.json({ ok: true, grant });
}

import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { getConsentHistory, resolveEffectiveConsent } from "@/lib/privacy/consent";
import { backfillConsentGrantsForProfile } from "@/lib/privacy/consent-backfill";

export async function GET(_req: Request, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    await requireAdmin("privacy:consent:view");
    const { profileId } = await params;

    await backfillConsentGrantsForProfile(profileId).catch(() => {});
    const [effective, history] = await Promise.all([resolveEffectiveConsent(profileId), getConsentHistory(profileId)]);

    return NextResponse.json({ effective, history });
  } catch (error) {
    return handleApiError(error);
  }
}

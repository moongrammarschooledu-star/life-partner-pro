import { prisma } from "@/lib/prisma";
import { evaluateRequirement } from "@/lib/compliance/rule-engine";

// Jurisdiction gate for privacy-sensitive signal families (device / network).
// Mirrors getFamilyMembership's pattern: resolve the profile's country to an
// ACTIVE jurisdiction, then ask the STEP 23 compliance rule engine. Absent an
// explicit ACTIVE DEVICE_SIGNALS_RESTRICTED rule the answer is "allowed" — the
// rules themselves are still OFF by default, so this is a second, additive lock.
export async function deviceSignalsAllowed(profileId: string): Promise<boolean> {
  try {
    const profile = await prisma.profile.findUnique({ where: { id: profileId }, select: { country: true } });
    if (!profile?.country) return true;
    const now = new Date();
    const jurisdiction = await prisma.jurisdiction.findFirst({
      where: { countryCode: profile.country, status: "ACTIVE", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
    });
    if (!jurisdiction) return true;
    const restriction = await evaluateRequirement<{ restricted: boolean }>(jurisdiction.id, "DEVICE_SIGNALS_RESTRICTED");
    return !(restriction.resolved && restriction.value?.restricted);
  } catch {
    // If we cannot establish that it is allowed, do not process device/network data.
    return false;
  }
}

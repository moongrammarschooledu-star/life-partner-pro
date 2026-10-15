import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { NoCodeChannelError, sendContactCode } from "@/lib/verification/contact-code";

// Step 1 of identity reconfirmation before a high-risk account action —
// reuses the one-time-code infrastructure (WhatsApp, SMS or e-mail) rather than a new challenge.
export async function POST(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const limited = await enforceConfiguredLimit(req, "my-account-reauth-send", { limit: 5, windowMs: 60_000 });
  if (limited) return limited;

  const profile = await prisma.profile.findUnique({ where: { id: profileId }, include: { contact: true } });
  if (!profile?.contact) return NextResponse.json({ error: "Not found." }, { status: 404 });

  try {
    const { channel, destinationMasked } = await sendContactCode(profileId, "REAUTH");
    return NextResponse.json({ ok: true, destinationMasked, channel });
  } catch (error) {
    if (error instanceof NoCodeChannelError) return NextResponse.json({ error: "We cannot send a code right now. Please try again later." }, { status: 503 });
    throw error;
  }
}

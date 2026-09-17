import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { sendOtp } from "@/lib/verification/otp-service";

// Step 1 of identity reconfirmation before a high-risk account action —
// reuses the existing email-OTP infrastructure rather than a new challenge.
export async function POST(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const key = `my-account-reauth-send:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 5, 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
  }

  const profile = await prisma.profile.findUnique({ where: { id: profileId }, include: { contact: true } });
  if (!profile?.contact) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { destinationMasked } = await sendOtp(profileId, "EMAIL", profile.contact.email);
  return NextResponse.json({ ok: true, destinationMasked });
}

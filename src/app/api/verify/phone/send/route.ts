import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { sendOtp } from "@/lib/verification/otp-service";
import { blockedResponse } from "@/lib/ops/guards";
import { normalizePhoneE164 } from "@/lib/marketing/normalize";
import { channelIsReal } from "@/lib/verification/contact-code";

export async function POST(req: Request) {
  const blocked = await blockedResponse({ flags: ["verification.enabled"] });
  if (blocked) return blocked;
  const limited = await enforceConfiguredLimit(req, "otp-phone-send", { limit: 5, windowMs: 60_000 });
  if (limited) return limited;

  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const profile = await prisma.profile.findUnique({ where: { id: profileId }, include: { contact: true } });
  if (!profile || profile.softDeleted || !profile.contact) return NextResponse.json({ error: "Not found." }, { status: 401 });

  // Without a real SMS provider a "sent" code would only be written to a log and never reach the phone: say so, instead of letting the person wait for it.
  const e164 = normalizePhoneE164(profile.contact.mobileNumber);
  if (!e164 || !(await channelIsReal("SMS", e164))) {
    return NextResponse.json(
      { error: "We cannot text a code to your phone right now. Our team will confirm your mobile number with you by phone or WhatsApp." },
      { status: 503 }
    );
  }

  const { destinationMasked } = await sendOtp(profileId, "PHONE", profile.contact.mobileNumber);

  return NextResponse.json({ ok: true, destinationMasked });
}

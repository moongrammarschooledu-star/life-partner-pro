import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { sendOtp } from "@/lib/verification/otp-service";
import { writeAudit } from "@/lib/audit";
import { blockedResponse } from "@/lib/ops/guards";

export async function POST(req: Request) {
  const blocked = await blockedResponse({ flags: ["verification.enabled"] });
  if (blocked) return blocked;
  const limited = await enforceConfiguredLimit(req, "otp-email-send", { limit: 5, windowMs: 60_000 });
  if (limited) return limited;

  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const profile = await prisma.profile.findUnique({ where: { id: profileId }, include: { contact: true } });
  if (!profile || profile.softDeleted || !profile.contact) return NextResponse.json({ error: "Not found." }, { status: 401 });

  const { destinationMasked } = await sendOtp(profileId, "EMAIL", profile.contact.email);
  await writeAudit({ action: "EMAIL_VERIFICATION_SENT", targetProfileId: profileId });

  return NextResponse.json({ ok: true, destinationMasked });
}

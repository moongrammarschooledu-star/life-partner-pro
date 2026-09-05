import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyProfileToken, APPLICANT_COOKIE } from "@/lib/applicant-session";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { sendOtp } from "@/lib/verification/otp-service";

export async function POST(req: Request) {
  const key = `otp-phone-send:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 5, 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
  }

  const cookieStore = await cookies();
  const profileId = verifyProfileToken(cookieStore.get(APPLICANT_COOKIE)?.value);
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const profile = await prisma.profile.findUnique({ where: { id: profileId }, include: { contact: true } });
  if (!profile || profile.softDeleted || !profile.contact) return NextResponse.json({ error: "Not found." }, { status: 401 });

  const { destinationMasked } = await sendOtp(profileId, "PHONE", profile.contact.mobileNumber);

  return NextResponse.json({ ok: true, destinationMasked });
}

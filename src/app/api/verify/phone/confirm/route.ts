import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyProfileToken, APPLICANT_COOKIE } from "@/lib/applicant-session";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { confirmOtp } from "@/lib/verification/otp-service";

export async function POST(req: Request) {
  const key = `otp-phone-confirm:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 10, 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
  }

  const cookieStore = await cookies();
  const profileId = verifyProfileToken(cookieStore.get(APPLICANT_COOKIE)?.value);
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const profile = await prisma.profile.findUnique({ where: { id: profileId }, select: { softDeleted: true } });
  if (!profile || profile.softDeleted) return NextResponse.json({ error: "Not found." }, { status: 401 });

  const { code } = await req.json();
  if (typeof code !== "string" || !code.trim()) {
    return NextResponse.json({ error: "Enter the code you received." }, { status: 400 });
  }

  const result = await confirmOtp(profileId, "PHONE", code);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true });
}

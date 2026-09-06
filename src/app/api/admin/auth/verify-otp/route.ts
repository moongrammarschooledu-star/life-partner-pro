import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { isExpired } from "@/lib/verification/otp";
import { issueStepUpToken } from "@/lib/step-up-token";

// Second step of the 2FA login flow — see precheck/route.ts and
// src/lib/auth.ts's authorize(), which is the actual enforcement point.
export async function POST(req: Request) {
  const { challengeId, code } = (await req.json()) as { challengeId?: string; code?: string };
  if (!challengeId || !code) {
    return NextResponse.json({ error: "Missing challenge or code." }, { status: 400 });
  }

  const challenge = await prisma.adminOtpChallenge.findUnique({
    where: { id: challengeId },
    include: { admin: { select: { email: true } } },
  });
  if (!challenge || challenge.consumedAt) {
    return NextResponse.json({ error: "Invalid or already-used code. Please sign in again." }, { status: 400 });
  }
  if (isExpired(challenge.expiresAt)) {
    return NextResponse.json({ error: "This code has expired. Please sign in again." }, { status: 400 });
  }
  if (challenge.attempts >= challenge.maxAttempts) {
    return NextResponse.json({ error: "Too many incorrect attempts. Please sign in again." }, { status: 400 });
  }

  const matches = await bcrypt.compare(code.trim(), challenge.codeHash);
  if (!matches) {
    await prisma.adminOtpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    return NextResponse.json({ error: "Incorrect code. Please try again." }, { status: 400 });
  }

  await prisma.adminOtpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });

  const otpToken = issueStepUpToken("LOGIN_2FA", challenge.admin.email.toLowerCase(), 2 * 60_000);
  return NextResponse.json({ verified: true, otpToken });
}

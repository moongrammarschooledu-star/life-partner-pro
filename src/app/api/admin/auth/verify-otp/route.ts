import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { isExpired } from "@/lib/verification/otp";
import { issueStepUpToken } from "@/lib/step-up-token";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";

// Second step of the 2FA login flow — see precheck/route.ts and
// src/lib/auth.ts's authorize(), which is the actual enforcement point.
export async function POST(req: Request) {
  // STEP 33 — this route is reachable before sign-in: a malformed body or a non-string value must answer 400, never throw (a thrown error is
  // a 500 that is also written to the error log, which an anonymous caller could then flood).
  let body: { challengeId?: unknown; code?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Missing challenge or code." }, { status: 400 });
  }
  const { challengeId, code } = body;
  if (typeof challengeId !== "string" || typeof code !== "string" || !challengeId || !code || code.length > 32 || challengeId.length > 64) {
    return NextResponse.json({ error: "Missing challenge or code." }, { status: 400 });
  }

  const limited = await enforcePersistentLimit(req, "admin-verify-otp", 20, 15 * 60_000, challengeId);
  if (limited) return limited;

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

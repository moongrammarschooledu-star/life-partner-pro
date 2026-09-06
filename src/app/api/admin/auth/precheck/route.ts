import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { checkAdminCredentials } from "@/lib/admin-login";
import { generateOtpCode, expiresInMinutes } from "@/lib/verification/otp";
import { notificationService } from "@/lib/notifications";

// Pre-check for the two-step 2FA login flow (spec §12) — never creates a
// session. If the admin has 2FA enabled (or their role requires it), this
// sends the OTP and the client shows an OTP screen before calling the real
// NextAuth signIn(). authorize() in src/lib/auth.ts independently re-verifies
// the password and, when required, the OTP proof — it never trusts this
// route's verdict alone, so skipping straight to signIn() cannot bypass 2FA.
export async function POST(req: Request) {
  const { email, password } = (await req.json()) as { email?: string; password?: string };
  if (!email || !password) {
    return NextResponse.json({ status: "invalid" }, { status: 400 });
  }

  const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = req.headers.get("user-agent");

  const result = await checkAdminCredentials({ email, password, ipAddress, userAgent });
  if (!result.ok) {
    if (result.reason === "locked") {
      return NextResponse.json({ status: "locked", retryAfterMinutes: result.retryAfterMinutes }, { status: 423 });
    }
    return NextResponse.json({ status: "invalid" }, { status: 401 });
  }

  if (!result.twoFactorRequired) {
    return NextResponse.json({ status: "ok" });
  }

  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  const challenge = await prisma.adminOtpChallenge.create({
    data: { adminId: result.admin.id, codeHash, expiresAt: expiresInMinutes(10) },
  });

  await notificationService.send({
    channel: "EMAIL",
    to: result.admin.email,
    subject: "Your Life Partner Pro admin login code",
    body: `Your login verification code is ${code}. It expires in 10 minutes.`,
  });

  return NextResponse.json({ status: "otp_required", challengeId: challenge.id });
}

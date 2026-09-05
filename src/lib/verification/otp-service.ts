import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { notificationService } from "@/lib/notifications";
import { generateOtpCode, generateEmailToken, maskPhone, maskEmail, expiresInMinutes, isExpired } from "@/lib/verification/otp";
import { recomputeStoredCompleteness } from "@/lib/verification/status";
import type { OtpChannel } from "@prisma/client";

// DB-touching OTP orchestration shared by phone and email verification —
// the pure primitives (code/token generation, masking, expiry math) live in
// otp.ts and are unit-tested there. Delivery goes through the same
// console-log NotificationService stub every other notification in this
// project uses — there is no real SMS/email provider anywhere in this
// codebase. The raw code/token is bcrypt-hashed before the DB write and
// never returned in any API response or rendered in any UI screen; to
// observe it in this environment, read Vercel's own Runtime Logs.

interface SendResult {
  otpId: string;
  destinationMasked: string;
}

export async function sendOtp(profileId: string, channel: "PHONE" | "EMAIL", destination: string): Promise<SendResult> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const expiryMinutes = settings?.otpExpiryMinutes ?? 10;
  const maxAttempts = settings?.otpMaxAttempts ?? 5;

  const code = channel === "PHONE" ? generateOtpCode() : generateEmailToken();
  const codeHash = await bcrypt.hash(code, 10);
  const destinationMasked = channel === "PHONE" ? maskPhone(destination) : maskEmail(destination);

  const otp = await prisma.otpVerification.create({
    data: {
      profileId,
      channel: channel as OtpChannel,
      codeHash,
      destinationMasked,
      maxAttempts,
      expiresAt: expiresInMinutes(expiryMinutes),
    },
  });

  await notificationService.send({
    channel: channel === "PHONE" ? "SMS" : "EMAIL",
    to: destination,
    subject: channel === "EMAIL" ? "Verify your Life Partner Pro email" : undefined,
    body:
      channel === "PHONE"
        ? `Your Life Partner Pro verification code is ${code}. It expires in ${expiryMinutes} minutes.`
        : `Your Life Partner Pro email verification code is ${code}. It expires in ${expiryMinutes} minutes.`,
  });

  await writeAudit({ action: "OTP_SENT", targetProfileId: profileId, meta: { channel } });

  return { otpId: otp.id, destinationMasked };
}

export type ConfirmOutcome = { ok: true } | { ok: false; error: string };

export async function confirmOtp(profileId: string, channel: "PHONE" | "EMAIL", submittedCode: string): Promise<ConfirmOutcome> {
  const otp = await prisma.otpVerification.findFirst({
    where: { profileId, channel: channel as OtpChannel, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) return { ok: false, error: "No pending verification found. Please request a new code." };

  if (isExpired(otp.expiresAt)) {
    await prisma.otpVerification.update({ where: { id: otp.id }, data: { status: "EXPIRED" } });
    return { ok: false, error: "This code has expired. Please request a new one." };
  }
  if (otp.attempts >= otp.maxAttempts) {
    await prisma.otpVerification.update({ where: { id: otp.id }, data: { status: "FAILED" } });
    return { ok: false, error: "Too many incorrect attempts. Please request a new code." };
  }

  const matches = await bcrypt.compare(submittedCode.trim(), otp.codeHash);
  if (!matches) {
    const attempts = otp.attempts + 1;
    await prisma.otpVerification.update({
      where: { id: otp.id },
      data: { attempts, status: attempts >= otp.maxAttempts ? "FAILED" : "PENDING" },
    });
    await writeAudit({ action: "OTP_FAILED", targetProfileId: profileId, meta: { channel } });
    return { ok: false, error: "Incorrect code. Please try again." };
  }

  await prisma.otpVerification.update({ where: { id: otp.id }, data: { status: "VERIFIED", verifiedAt: new Date() } });

  const now = new Date();
  await prisma.profileVerification.upsert({
    where: { profileId },
    update: channel === "PHONE" ? { phoneVerifiedAt: now } : { emailVerifiedAt: now },
    create: { profileId, status: "VERIFICATION_PENDING", ...(channel === "PHONE" ? { phoneVerifiedAt: now } : { emailVerifiedAt: now }) },
  });

  const verification = await prisma.profileVerification.findUnique({ where: { profileId } });
  if (verification) {
    await prisma.verificationItem.updateMany({
      where: { profileVerificationId: verification.id, itemKey: channel === "PHONE" ? "mobile_verified" : "email_verified" },
      data: { status: "COMPLETED", completedAt: now },
    });
  }

  await writeAudit({ action: channel === "PHONE" ? "OTP_VERIFIED" : "EMAIL_VERIFIED", targetProfileId: profileId, meta: { channel } });
  await recomputeStoredCompleteness(profileId);

  return { ok: true };
}

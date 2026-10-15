import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { notificationService } from "@/lib/notifications";
import { generateOtpCode, generateEmailToken, maskPhone, maskEmail, expiresInMinutes, isExpired } from "@/lib/verification/otp";
import { recomputeStoredCompleteness } from "@/lib/verification/status";
import { sendNotification } from "@/lib/notifications/notification-service";
import { publishSecurityEvent } from "@/lib/security/event-bus";
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

export type OtpPurpose = "VERIFY" | "LOGIN";

// A code for a PHONE destination is a short number. It can be delivered by SMS (the default) or by WhatsApp (an approved authentication template, see the WhatsApp adapter).
export interface SendOtpOptions {
  deliverVia?: "SMS" | "WHATSAPP";
}

export async function sendOtp(profileId: string, channel: "PHONE" | "EMAIL", destination: string, purpose: OtpPurpose = "VERIFY", options: SendOtpOptions = {}): Promise<SendResult> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const expiryMinutes = settings?.otpExpiryMinutes ?? 10;
  const maxAttempts = settings?.otpMaxAttempts ?? 5;

  // STEP 33 — a sign-in code is a short number the person types, and only the NEWEST one may work: any earlier pending code for this
  // profile and channel is retired first, so a request-and-wait loop can never leave several valid codes lying in a mailbox.
  // Since STEP 38 a sign-in code can arrive by phone or by e-mail, so retiring is across both: a code sent by WhatsApp must not leave an older e-mailed one usable.
  if (purpose === "LOGIN") {
    await prisma.otpVerification.updateMany({ where: { profileId, status: "PENDING" }, data: { status: "EXPIRED" } });
  }

  const code = channel === "PHONE" || purpose === "LOGIN" ? generateOtpCode() : generateEmailToken();
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

  try {
    await notificationService.send({
    channel: channel === "PHONE" ? (options.deliverVia ?? "SMS") : "EMAIL",
    to: destination,
    profileId,
    code,
    subject: purpose === "LOGIN" ? "Your Life Partner Pro sign-in code" : channel === "EMAIL" ? "Verify your Life Partner Pro email" : undefined,
    body:
      purpose === "LOGIN"
        ? `Your Life Partner Pro sign-in code is ${code}. It expires in ${expiryMinutes} minutes. If you did not try to sign in, you can ignore this message and nobody will be signed in.`
        : channel === "PHONE"
          ? `Your Life Partner Pro verification code is ${code}. It expires in ${expiryMinutes} minutes.`
          : `Your Life Partner Pro email verification code is ${code}. It expires in ${expiryMinutes} minutes.`,
    });
  } catch (error) {
    // The code never reached the person: retire it, so a failed delivery leaves nothing usable behind, and let the caller decide what to do next.
    await prisma.otpVerification.update({ where: { id: otp.id }, data: { status: "EXPIRED" } }).catch(() => {});
    throw error;
  }

  await writeAudit({ action: "OTP_SENT", targetProfileId: profileId, meta: { channel, purpose } });
  await publishSecurityEvent({ eventType: "OTP_REQUESTED", profileId, source: purpose === "LOGIN" ? "applicant-login" : "otp-service", meta: { channel, purpose } });

  return { otpId: otp.id, destinationMasked };
}

export type ConfirmOutcome = { ok: true } | { ok: false; error: string };

// The code check itself: finds the newest pending code, enforces expiry and the attempt limit, compares, and marks the code used on success.
// Shared by verification (which then records that the contact is verified) and sign-in (which must not).
async function checkOtp(profileId: string, channel: "PHONE" | "EMAIL", submittedCode: string, source: string): Promise<ConfirmOutcome> {
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
    // STEP 33 — an atomic increment: parallel wrong guesses must each be counted, or the attempt limit could be outrun by sending them together.
    const bumped = await prisma.otpVerification.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    if (bumped.attempts >= bumped.maxAttempts) await prisma.otpVerification.update({ where: { id: otp.id }, data: { status: "FAILED" } });
    await writeAudit({ action: "OTP_FAILED", targetProfileId: profileId, meta: { channel } });
    await publishSecurityEvent({ eventType: "OTP_FAILED", profileId, source, outcome: "WRONG_CODE", meta: { channel } });
    return { ok: false, error: "Incorrect code. Please try again." };
  }

  await prisma.otpVerification.update({ where: { id: otp.id }, data: { status: "VERIFIED", verifiedAt: new Date() } });
  return { ok: true };
}

// STEP 33 — completes an applicant sign-in. Only proves control of the e-mail address: it deliberately does NOT touch the verification
// record, the completeness figure or send an "e-mail verified" notice, none of which a routine sign-in should produce.
export async function confirmLoginOtp(profileId: string, submittedCode: string): Promise<ConfirmOutcome> {
  // The newest pending code decides which channel is checked (it is the only one that can still work: sending a new code retires the others).
  const newest = await prisma.otpVerification.findFirst({ where: { profileId, status: "PENDING" }, orderBy: { createdAt: "desc" }, select: { channel: true } });
  const channel: "PHONE" | "EMAIL" = newest?.channel === "PHONE" ? "PHONE" : "EMAIL";
  const outcome = await checkOtp(profileId, channel, submittedCode.slice(0, 64), "applicant-login");
  if (outcome.ok) await writeAudit({ action: "OTP_VERIFIED", targetProfileId: profileId, meta: { channel, purpose: "LOGIN" } });
  return outcome;
}

// Re-confirming identity before a high-risk account action (deactivate, delete, export): the same idea, for a code that was sent for that purpose.
export async function confirmNewestOtp(profileId: string, submittedCode: string): Promise<ConfirmOutcome> {
  const newest = await prisma.otpVerification.findFirst({ where: { profileId, status: "PENDING" }, orderBy: { createdAt: "desc" }, select: { channel: true } });
  return confirmOtp(profileId, newest?.channel === "PHONE" ? "PHONE" : "EMAIL", submittedCode);
}

export async function confirmOtp(profileId: string, channel: "PHONE" | "EMAIL", submittedCode: string): Promise<ConfirmOutcome> {
  const checked = await checkOtp(profileId, channel, submittedCode, "otp-service");
  if (!checked.ok) return checked;

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
  await sendNotification({ profileId, type: channel === "PHONE" ? "MOBILE_VERIFIED" : "EMAIL_VERIFIED", data: {} });

  return { ok: true };
}

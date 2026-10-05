import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { notificationService } from "@/lib/notifications";
import { generateOtpCode, isExpired } from "@/lib/verification/otp";

// Self-service admin password reset (e-mail one-time code). It reuses AdminOtpChallenge with its own `purpose`, so a
// reset code can never be accepted as a login 2FA code or the other way round.
//
// Properties that matter:
//  • No account enumeration: the request step does the same visible thing (and takes similar time) whether or not the
//    e-mail belongs to an active admin; the completion step returns one generic failure for every wrong-code case.
//  • The code is stored only as a bcrypt hash, expires in 1 minute, allows 5 wrong attempts, and is single-use (the
//    consume step is an atomic claim, so two parallel submissions cannot both succeed).
//  • A new request supersedes earlier unused codes and is rate-limited per account (cooldown) as well as by the routes.
//  • On success every existing admin session is revoked, the forced-reset flag is cleared, and the admin is told by e-mail.
//  • 2FA is NOT bypassed: the next sign-in still goes through the normal login flow, including the login code.

export const RESET_PURPOSE = "PASSWORD_RESET";
// Deliberately short (owner's requirement): a code that sits in a mailbox is a code that can be misused.
export const RESET_CODE_TTL_SECONDS = 60;
export const RESET_MAX_ATTEMPTS = 5;
// Shorter than the code lifetime so a person whose code expired (or never arrived) can ask for another one promptly.
export const RESET_REQUEST_COOLDOWN_MS = 30_000;
export const MAX_PASSWORD_LENGTH = 128;

export const GENERIC_REQUEST_MESSAGE = "If an admin account exists for that e-mail, a reset code has been sent. It expires in 1 minute.";
export const GENERIC_FAILURE_MESSAGE = "The code is invalid or has expired. Please request a new one.";

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

export function normaliseAdminEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

// Waste roughly the same time as a real code hash so the response time does not reveal whether the account exists.
async function burnTime(): Promise<void> {
  await bcrypt.hash(generateOtpCode(), 10);
}

export async function requestAdminPasswordReset(rawEmail: unknown, ctx: { ipAddress?: string | null } = {}): Promise<void> {
  const email = normaliseAdminEmail(rawEmail);
  if (!email) return burnTime();

  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin || !admin.active) return burnTime();

  // Cooldown: a second request within 30 seconds is ignored (prevents e-mail flooding of the real owner).
  const recent = await prisma.adminOtpChallenge.findFirst({
    where: { adminId: admin.id, purpose: RESET_PURPOSE, createdAt: { gte: new Date(Date.now() - RESET_REQUEST_COOLDOWN_MS) } },
    select: { id: true },
  });
  if (recent) return burnTime();

  // Earlier unused codes stop working the moment a new one is issued.
  await prisma.adminOtpChallenge.updateMany({ where: { adminId: admin.id, purpose: RESET_PURPOSE, consumedAt: null }, data: { consumedAt: new Date() } });

  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  const challenge = await prisma.adminOtpChallenge.create({
    data: { adminId: admin.id, purpose: RESET_PURPOSE, codeHash, maxAttempts: RESET_MAX_ATTEMPTS, expiresAt: new Date(Date.now() + RESET_CODE_TTL_SECONDS * 1000) },
  });

  try {
    await notificationService.send({
      channel: "EMAIL",
      to: admin.email,
      subject: "Your Life Partner Pro admin password reset code",
      body: `Your password reset code is ${code}. It expires in 1 minute and can be used once. If you did not ask to reset your password, ignore this e-mail — your password has not been changed.`,
    });
  } catch (error) {
    // A code nobody received is useless; remove it. The caller still gets the generic answer (no delivery oracle).
    await prisma.adminOtpChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);
    console.error("[admin-password-reset] code delivery failed", error instanceof Error ? error.message : "error");
    return;
  }

  await writeAudit({ action: "ADMIN_USER_PASSWORD_RESET", adminId: admin.id, meta: { stage: "requested", self: true, challengeId: challenge.id, ip: ctx.ipAddress ?? null } }).catch(() => undefined);
}

export type ResetResult = { ok: true } | { ok: false; reason: "weak_password"; message: string } | { ok: false; reason: "invalid_code" };

export async function completeAdminPasswordReset(input: { email: unknown; code: unknown; newPassword: unknown; ipAddress?: string | null }): Promise<ResetResult> {
  // Password policy first: it does not depend on the account, so it cannot leak anything, and a typo in the new password
  // must not burn one of the five code attempts.
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const minLength = Math.max(8, settings?.passwordMinLength ?? 8);
  if (typeof input.newPassword !== "string" || input.newPassword.length < minLength) {
    return { ok: false, reason: "weak_password", message: `The new password must be at least ${minLength} characters.` };
  }
  if (input.newPassword.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, reason: "weak_password", message: `The new password must be at most ${MAX_PASSWORD_LENGTH} characters.` };
  }

  const email = normaliseAdminEmail(input.email);
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!email || !/^\d{6}$/.test(code)) {
    await burnTime();
    return { ok: false, reason: "invalid_code" };
  }

  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin || !admin.active) {
    await burnTime();
    return { ok: false, reason: "invalid_code" };
  }

  const challenge = await prisma.adminOtpChallenge.findFirst({
    where: { adminId: admin.id, purpose: RESET_PURPOSE, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge || isExpired(challenge.expiresAt) || challenge.attempts >= challenge.maxAttempts) {
    await burnTime();
    return { ok: false, reason: "invalid_code" };
  }

  const matches = await bcrypt.compare(code, challenge.codeHash);
  if (!matches) {
    await prisma.adminOtpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, reason: "invalid_code" };
  }

  // Atomic single-use claim: only one of two simultaneous correct submissions gets count === 1.
  const claim = await prisma.adminOtpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (claim.count !== 1) return { ok: false, reason: "invalid_code" };

  const passwordHash = await bcrypt.hash(input.newPassword, 12);
  await prisma.adminUser.update({ where: { id: admin.id }, data: { passwordHash, mustResetPassword: false } });
  const revoked = await prisma.adminSession.updateMany({ where: { adminId: admin.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await prisma.adminOtpChallenge.updateMany({ where: { adminId: admin.id, purpose: RESET_PURPOSE, consumedAt: null }, data: { consumedAt: new Date() } });

  await writeAudit({ action: "ADMIN_USER_PASSWORD_RESET", adminId: admin.id, meta: { stage: "completed", self: true, sessionsRevoked: revoked.count, ip: input.ipAddress ?? null } }).catch(() => undefined);

  // Tell the owner (best effort): if this was not them, they know to act at once.
  await notificationService
    .send({
      channel: "EMAIL",
      to: admin.email,
      subject: "Your Life Partner Pro admin password was changed",
      body: "Your admin password was just reset using an e-mailed code, and all your signed-in sessions were ended. If this was not you, contact your Super Admin immediately.",
    })
    .catch(() => undefined);

  return { ok: true };
}

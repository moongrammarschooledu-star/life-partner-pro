import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { AdminRole } from "@/lib/permissions";
import type { AdminUser } from "@prisma/client";

// Shared by both the pre-check route (src/app/api/admin/auth/precheck) and
// NextAuth's authorize() in src/lib/auth.ts — the latter is the only place a
// session is ever actually minted, so it independently re-runs this same
// check rather than trusting that precheck was called first (closing any
// "skip the OTP screen, call signIn directly" bypass at the source).
//
// Lockout/history is backed by AdminLoginHistory (a real DB table), not the
// in-memory rateLimit() helper — that helper's own comment documents it
// doesn't survive serverless cold starts, which isn't durable enough for
// something as consequential as account lockout.

export type CredentialCheckResult =
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; retryAfterMinutes: number }
  | { ok: true; admin: AdminUser; twoFactorRequired: boolean };

async function recordAttempt(params: {
  adminId?: string | null;
  email: string;
  event: "FAILURE" | "LOCKED";
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  await prisma.adminLoginHistory.create({
    data: {
      adminId: params.adminId ?? null,
      email: params.email.toLowerCase(),
      event: params.event,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    },
  });
}

export async function checkAdminCredentials(params: {
  email: string;
  password: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<CredentialCheckResult> {
  const email = params.email.toLowerCase();
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const maxAttempts = settings?.loginMaxAttempts ?? 5;
  const lockoutMinutes = settings?.loginLockoutMinutes ?? 15;
  const cutoff = new Date(Date.now() - lockoutMinutes * 60_000);

  const recentFailures = await prisma.adminLoginHistory.count({
    where: { email, event: "FAILURE", createdAt: { gte: cutoff } },
  });
  if (recentFailures >= maxAttempts) {
    await recordAttempt({ email, event: "LOCKED", ipAddress: params.ipAddress, userAgent: params.userAgent });
    return { ok: false, reason: "locked", retryAfterMinutes: lockoutMinutes };
  }

  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin || !admin.active) {
    await recordAttempt({ email, event: "FAILURE", ipAddress: params.ipAddress, userAgent: params.userAgent });
    return { ok: false, reason: "invalid" };
  }

  const valid = await bcrypt.compare(params.password, admin.passwordHash);
  if (!valid) {
    await recordAttempt({ adminId: admin.id, email, event: "FAILURE", ipAddress: params.ipAddress, userAgent: params.userAgent });
    return { ok: false, reason: "invalid" };
  }

  const requiredRoles = (settings?.twoFactorRequiredRoles as AdminRole[] | null) ?? [];
  const twoFactorRequired = admin.twoFactorEnabled || requiredRoles.includes(admin.role as AdminRole);

  return { ok: true, admin, twoFactorRequired };
}

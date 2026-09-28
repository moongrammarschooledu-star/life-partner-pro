import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { publishSecurityEvent } from "@/lib/security/event-bus";

// Spec §10/§32 — makes "Active Sessions"/"Log Out Other Sessions" real for
// applicant accounts, mirroring AdminSession's shape (STEP 11). Applicants
// have no passwords/accounts today (see applicant-session.ts) — this is a
// session record layered on top of the existing stateless signed cookie,
// not a new auth system.
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000; // matches the 1-year cookie maxAge

export async function createProfileSession(profileId: string, deviceInfo?: string, userAgent?: string, ipAddress?: string) {
  const session = await createProfileSessionRow(profileId, deviceInfo, userAgent, ipAddress);
  // STEP 24 — informational only (feeds the OFF-by-default shared device/network rules; never a
  // signal by itself). IP/user-agent are stored by the bus only as salted hashes, and only when enabled.
  await publishSecurityEvent({ eventType: "NEW_DEVICE_SESSION", profileId, ip: ipAddress, userAgent, source: "profile-session", evaluate: false });
  return session;
}

async function createProfileSessionRow(profileId: string, deviceInfo?: string, userAgent?: string, ipAddress?: string) {
  return prisma.profileSession.create({
    data: {
      profileId,
      deviceInfo: deviceInfo ?? null,
      userAgent: userAgent ?? null,
      ipAddress: ipAddress ?? null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
}

export async function touchAndValidateSession(sessionId: string, profileId: string): Promise<boolean> {
  const session = await prisma.profileSession.findUnique({ where: { id: sessionId } });
  if (!session || session.profileId !== profileId) return false;
  if (session.revokedAt) return false;
  if (session.expiresAt.getTime() < Date.now()) return false;
  await prisma.profileSession.update({ where: { id: sessionId }, data: { lastActiveAt: new Date() } }).catch(() => {});
  return true;
}

export async function listProfileSessions(profileId: string) {
  return prisma.profileSession.findMany({
    where: { profileId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastActiveAt: "desc" },
  });
}

export async function revokeProfileSession(sessionId: string, profileId: string) {
  const session = await prisma.profileSession.updateMany({
    where: { id: sessionId, profileId },
    data: { revokedAt: new Date() },
  });
  if (session.count > 0) {
    await writeAudit({ action: "PROFILE_SESSION_REVOKED", targetProfileId: profileId, meta: { sessionId } });
  }
  return session.count > 0;
}

export async function revokeOtherProfileSessions(profileId: string, keepSessionId?: string) {
  const result = await prisma.profileSession.updateMany({
    where: { profileId, revokedAt: null, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
  if (result.count > 0) {
    await writeAudit({ action: "PROFILE_SESSION_REVOKED", targetProfileId: profileId, meta: { count: result.count, scope: "others" } });
  }
  return result.count;
}

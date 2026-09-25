import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";

// Mirrors src/lib/profile-session.ts's exact shape — a parallel, not shared,
// revocation/tracking table (Decision 2/11 of the STEP 22 plan).
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — shorter than the applicant's 1yr since this is a password-backed, revocable account, not a passwordless bookmark-style session

export async function createFamilyMemberSession(familyMemberId: string, deviceInfo?: string, userAgent?: string, ipAddress?: string) {
  return prisma.familyMemberSession.create({
    data: {
      familyMemberId,
      deviceInfo: deviceInfo ?? null,
      userAgent: userAgent ?? null,
      ipAddress: ipAddress ?? null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
}

export async function touchAndValidateFamilyMemberSession(sessionId: string): Promise<string | null> {
  const session = await prisma.familyMemberSession.findUnique({ where: { id: sessionId } });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;
  await prisma.familyMemberSession.update({ where: { id: sessionId }, data: { lastActiveAt: new Date() } }).catch(() => {});
  return session.familyMemberId;
}

export async function listFamilyMemberSessions(familyMemberId: string) {
  return prisma.familyMemberSession.findMany({
    where: { familyMemberId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastActiveAt: "desc" },
  });
}

export async function revokeFamilyMemberSession(sessionId: string, familyMemberId: string) {
  const result = await prisma.familyMemberSession.updateMany({
    where: { id: sessionId, familyMemberId },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

// Called by revokeAccess()/suspendFamilyMember() (Decision 11) so a
// revoked/suspended family member's EXISTING session cookie stops working on
// their very next request, not just on their next login attempt.
export async function revokeAllFamilyMemberSessions(familyMemberId: string, reason?: string) {
  const result = await prisma.familyMemberSession.updateMany({
    where: { familyMemberId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count > 0) {
    await writeAudit({ action: "FAMILY_SESSION_REVOKED", actorFamilyMemberId: familyMemberId, meta: { count: result.count, reason: reason ?? "access_revoked" } });
  }
  return result.count;
}

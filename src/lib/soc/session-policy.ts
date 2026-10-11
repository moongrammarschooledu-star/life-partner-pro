import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { writeAudit } from "@/lib/audit";
import { verifyStepUpToken } from "@/lib/step-up-token";

// STEP 32 — administrator session policy. Everything here is OFF or permissive until an admin sets it in the security configuration, so
// deploying this changes nothing by itself:
//   idle timeout          — a session unused for N minutes is ended on its next request (SocSettings.sessionIdleMinutes; empty = no timeout);
//   concurrent session cap — a new sign-in beyond the cap ends the OLDEST sessions (SocSettings.maxConcurrentSessions; empty = no cap);
//   step-up               — high-risk actions ask for the password again (on by default; it only ever adds a prompt).
// Reading the policy is cached for 30 seconds per server instance, and it FAILS OPEN: an unreadable policy never locks anyone out.

export interface SessionPolicy {
  idleMinutes: number | null;
  maxConcurrent: number | null;
  stepUp: boolean;
  enforceMfa: boolean;
}

const OPEN_POLICY: SessionPolicy = { idleMinutes: null, maxConcurrent: null, stepUp: true, enforceMfa: false };
const TTL_MS = 30_000;
let cache: { value: SessionPolicy; at: number } | null = null;

export function invalidateSessionPolicy(): void {
  cache = null;
}

export async function getSessionPolicy(): Promise<SessionPolicy> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  let value = OPEN_POLICY;
  try {
    const row = await prisma.socSettings.findUnique({ where: { id: 1 } });
    if (row) value = { idleMinutes: row.sessionIdleMinutes ?? null, maxConcurrent: row.maxConcurrentSessions ?? null, stepUp: row.stepUpForHighRisk, enforceMfa: row.enforceMfaPrivileged };
  } catch {
    /* fail-open: keep the permissive policy */
  }
  cache = { value, at: Date.now() };
  return value;
}

// ---- pure decisions ----
export function idleExpired(lastActiveAt: Date, now: Date, idleMinutes: number | null): boolean {
  if (!idleMinutes || idleMinutes <= 0) return false;
  return now.getTime() - lastActiveAt.getTime() > idleMinutes * 60_000;
}

// Keeps the NEWEST `max` sessions and returns the ids of the rest (oldest first). No cap → nothing to end.
export function sessionsToRevoke(sessions: Array<{ id: string; createdAt: Date }>, max: number | null): string[] {
  if (!max || max <= 0 || sessions.length <= max) return [];
  const newestFirst = [...sessions].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return newestFirst.slice(max).map((s) => s.id).reverse();
}

// ---- enforcement ----
// Called by requireAdmin with the session row it already loaded. Returns true when the session was ended for inactivity.
export async function enforceIdleTimeout(record: { id: string; adminId: string; lastActiveAt: Date }, now: Date = new Date()): Promise<boolean> {
  try {
    const policy = await getSessionPolicy();
    if (!idleExpired(record.lastActiveAt, now, policy.idleMinutes)) return false;
    await prisma.adminSession.updateMany({ where: { id: record.id, revokedAt: null }, data: { revokedAt: now } });
    const events = await import("@/lib/soc/events");
    await events.publishSessionAnomaly({ adminId: record.adminId, reason: "IDLE_TIMEOUT" });
    return true;
  } catch {
    return false; // fail-open
  }
}

// Called once, right after a session is created. Never throws: sign-in must not fail because of monitoring.
export async function onAdminSessionCreated(p: { adminId: string; sessionId: string; ip: string | null; userAgent: string | null; now?: Date }): Promise<void> {
  try {
    const now = p.now ?? new Date();
    const events = await import("@/lib/soc/events");

    // 1. a sign-in from a browser/device this administrator has not used before (but not their very first sign-in)
    const others = await prisma.adminSession.count({ where: { adminId: p.adminId, id: { not: p.sessionId } } });
    if (others > 0 && p.userAgent) {
      const known = await prisma.adminSession.count({ where: { adminId: p.adminId, id: { not: p.sessionId }, userAgent: p.userAgent, createdAt: { gte: new Date(now.getTime() - 90 * 86_400_000) } } });
      if (known === 0) await events.publishAdminNewDevice({ adminId: p.adminId, ip: p.ip, userAgent: p.userAgent });
    }

    // 2. the concurrent-session cap
    const policy = await getSessionPolicy();
    if (policy.maxConcurrent) {
      const active = await prisma.adminSession.findMany({ where: { adminId: p.adminId, revokedAt: null, expiresAt: { gt: now } }, select: { id: true, createdAt: true }, take: 100 });
      const ids = sessionsToRevoke(active, policy.maxConcurrent).filter((id) => id !== p.sessionId);
      if (ids.length) {
        await prisma.adminSession.updateMany({ where: { id: { in: ids } }, data: { revokedAt: now } });
        await writeAudit({ action: "ADMIN_SESSION_REVOKED", adminId: p.adminId, meta: { count: ids.length, via: "session-policy", cap: policy.maxConcurrent } });
        await events.publishSessionAnomaly({ adminId: p.adminId, reason: "TOO_MANY_SESSIONS", ip: p.ip });
      }
    }
  } catch {
    /* fail-open */
  }
}

// High-risk actions (approving containment, changing a rule's strength, changing configuration) ask for the password again. The client gets
// a 5-minute token from /api/admin/auth/reauth and sends it back; it is bound to THIS administrator.
export async function assertStepUp(adminId: string, token: string | null | undefined): Promise<void> {
  const policy = await getSessionPolicy();
  if (!policy.stepUp) return;
  let ok = false;
  try {
    ok = verifyStepUpToken(token, "REAUTH", adminId);
  } catch {
    ok = false;
  }
  if (!ok) throw new HttpError(403, "Please confirm your password to continue (re-authentication required).");
}

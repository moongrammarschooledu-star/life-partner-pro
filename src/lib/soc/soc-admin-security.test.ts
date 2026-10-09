import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// STEP 32 milestone 5 — administrator security: the session policy (idle timeout, concurrent-session cap, new-device signal, step-up),
// MFA coverage and enforcement for privileged roles, and the read models behind the admin-security screen.

type Row = Record<string, unknown> & { id?: string };
const h = vi.hoisted(() => ({ fake: null as unknown as ReturnType<typeof import("@/test-utils/fake-prisma").createFakeDb> }));
const published: Row[] = [];
const audits: Row[] = [];
const perms: Record<string, string[]> = {
  SUPER: ["admin:manage", "soc:containment:approve", "system:config:manage"],
  MANAGER: ["profile:view", "reports:view"],
  STAFF: ["profile:view"],
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", async () => {
  const { createFakeDb } = await import("@/test-utils/fake-prisma");
  h.fake = createFakeDb({ relations: { adminSession: { admin: ["adminUser", "adminId", "one"] } } });
  return { prisma: h.fake.prisma };
});
vi.mock("@/lib/security/event-bus", () => ({ publishSecurityEvent: vi.fn(async (e: Row) => { published.push(e); return { recorded: true }; }) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/effective-permissions", () => ({ resolveEffectivePermissions: vi.fn(async (a: { role: string }) => perms[a.role] ?? []) }));

const policyMod = await import("./session-policy");
const sec = await import("./admin-security");
const stepUp = await import("@/lib/step-up-token");

const rows = (t: string) => h.fake.rows(t);
const ROOT = join(__dirname, "..", "..", "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MIN = 60_000;
const NOW = new Date("2026-10-09T12:00:00Z");
const ago = (m: number) => new Date(NOW.getTime() - m * MIN);

beforeEach(() => {
  h.fake.reset();
  published.length = 0;
  audits.length = 0;
  policyMod.invalidateSessionPolicy();
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret-for-step-up");
});

const setPolicy = (over: Row) => {
  rows("socSettings").length = 0;
  rows("socSettings").push({ id: 1, sessionIdleMinutes: null, maxConcurrentSessions: null, stepUpForHighRisk: true, enforceMfaPrivileged: false, ...over });
  policyMod.invalidateSessionPolicy();
};

describe("pure session decisions", () => {
  it("idle: off when empty, strict after the limit", () => {
    const last = ago(30);
    expect(policyMod.idleExpired(last, NOW, null)).toBe(false);
    expect(policyMod.idleExpired(last, NOW, 0)).toBe(false);
    expect(policyMod.idleExpired(last, NOW, 30)).toBe(false); // exactly at the limit is still fine
    expect(policyMod.idleExpired(last, NOW, 29)).toBe(true);
  });

  it("the cap keeps the NEWEST sessions and ends the oldest", () => {
    const s = (id: string, m: number) => ({ id, createdAt: ago(m) });
    expect(policyMod.sessionsToRevoke([s("a", 50), s("b", 40), s("c", 30), s("d", 5)], 2)).toEqual(["a", "b"]);
    expect(policyMod.sessionsToRevoke([s("a", 50), s("b", 40)], 2)).toEqual([]);
    expect(policyMod.sessionsToRevoke([s("a", 50), s("b", 40), s("c", 30)], null)).toEqual([]);
    expect(policyMod.sessionsToRevoke([s("a", 50), s("b", 40), s("c", 30)], 1)).toEqual(["a", "b"]);
  });

  it("privileged = can do something hard to undo or widen others' access", () => {
    expect(sec.isPrivileged(["admin:manage"])).toBe(true);
    expect(sec.isPrivileged(["soc:containment:approve"])).toBe(true);
    expect(sec.isPrivileged(["profile:view", "reports:view"])).toBe(false);
    expect(sec.isPrivileged([])).toBe(false);
  });

  it("session addresses are masked", () => {
    expect(sec.maskIp("203.0.113.77")).toBe("203.0.113.…");
    expect(sec.maskIp("2001:db8:85a3:0:0:8a2e:370:7334")).toBe("2001:db8:85a3:…");
    expect(sec.maskIp(null)).toBeNull();
  });
});

describe("the policy is read from settings and fails open", () => {
  it("is permissive with no row, and reads the row when there is one (cached until invalidated)", async () => {
    expect(await policyMod.getSessionPolicy()).toEqual({ idleMinutes: null, maxConcurrent: null, stepUp: true, enforceMfa: false });
    setPolicy({ sessionIdleMinutes: 20, maxConcurrentSessions: 3, enforceMfaPrivileged: true });
    expect(await policyMod.getSessionPolicy()).toEqual({ idleMinutes: 20, maxConcurrent: 3, stepUp: true, enforceMfa: true });
    rows("socSettings")[0].sessionIdleMinutes = 5;
    expect((await policyMod.getSessionPolicy()).idleMinutes).toBe(20); // cached
    policyMod.invalidateSessionPolicy();
    expect((await policyMod.getSessionPolicy()).idleMinutes).toBe(5);
  });
});

describe("idle timeout", () => {
  it("ends an idle session, records an anomaly, and leaves an active one alone", async () => {
    setPolicy({ sessionIdleMinutes: 30 });
    rows("adminSession").push({ id: "s1", adminId: "a1", revokedAt: null, lastActiveAt: ago(45) }, { id: "s2", adminId: "a1", revokedAt: null, lastActiveAt: ago(10) });
    expect(await policyMod.enforceIdleTimeout({ id: "s1", adminId: "a1", lastActiveAt: ago(45) }, NOW)).toBe(true);
    expect(rows("adminSession").find((s) => s.id === "s1")?.revokedAt).toEqual(NOW);
    expect(published).toEqual([expect.objectContaining({ eventType: "ADMIN_SESSION_ANOMALY", adminId: "a1", outcome: "IDLE_TIMEOUT" })]);
    expect(await policyMod.enforceIdleTimeout({ id: "s2", adminId: "a1", lastActiveAt: ago(10) }, NOW)).toBe(false);
    expect(rows("adminSession").find((s) => s.id === "s2")?.revokedAt).toBeNull();
  });

  it("does nothing when no timeout is configured", async () => {
    expect(await policyMod.enforceIdleTimeout({ id: "s1", adminId: "a1", lastActiveAt: ago(100000) }, NOW)).toBe(false);
  });
});

describe("sign-in signals and the concurrent-session cap", () => {
  const sess = (id: string, minAgo: number, ua = "Chrome on Windows") => rows("adminSession").push({ id, adminId: "a1", userAgent: ua, createdAt: ago(minAgo), revokedAt: null, expiresAt: new Date(NOW.getTime() + 3_600_000) });

  it("a first-ever sign-in is not a 'new device'; a different browser later is; the same browser is not", async () => {
    sess("s1", 0);
    await policyMod.onAdminSessionCreated({ adminId: "a1", sessionId: "s1", ip: "203.0.113.5", userAgent: "Chrome on Windows", now: NOW });
    expect(published).toHaveLength(0);
    sess("s2", 0, "Safari on iOS");
    await policyMod.onAdminSessionCreated({ adminId: "a1", sessionId: "s2", ip: "203.0.113.5", userAgent: "Safari on iOS", now: NOW });
    expect(published.map((p) => p.eventType)).toEqual(["NEW_DEVICE_SESSION"]);
    expect(published[0]).toMatchObject({ adminId: "a1", source: "admin-login" });
    published.length = 0;
    sess("s3", 0, "Chrome on Windows");
    await policyMod.onAdminSessionCreated({ adminId: "a1", sessionId: "s3", ip: "203.0.113.5", userAgent: "Chrome on Windows", now: NOW });
    expect(published).toHaveLength(0);
  });

  it("with a cap of 2, a third sign-in ends the oldest session and says so", async () => {
    setPolicy({ maxConcurrentSessions: 2 });
    sess("old", 300);
    sess("mid", 200);
    sess("new", 0);
    await policyMod.onAdminSessionCreated({ adminId: "a1", sessionId: "new", ip: null, userAgent: "Chrome on Windows", now: NOW });
    expect(rows("adminSession").filter((s) => s.revokedAt).map((s) => s.id)).toEqual(["old"]);
    expect(audits).toEqual([expect.objectContaining({ action: "ADMIN_SESSION_REVOKED", meta: expect.objectContaining({ via: "session-policy", count: 1, cap: 2 }) })]);
    expect(published.some((p) => p.eventType === "ADMIN_SESSION_ANOMALY" && p.outcome === "TOO_MANY_SESSIONS")).toBe(true);
  });

  it("never ends the session that was just created, and does nothing with no cap", async () => {
    sess("a", 100);
    sess("b", 0);
    await policyMod.onAdminSessionCreated({ adminId: "a1", sessionId: "b", ip: null, userAgent: "Chrome on Windows", now: NOW });
    expect(rows("adminSession").every((s) => !s.revokedAt)).toBe(true);
    setPolicy({ maxConcurrentSessions: 1 });
    await policyMod.onAdminSessionCreated({ adminId: "a1", sessionId: "b", ip: null, userAgent: "Chrome on Windows", now: NOW });
    expect(rows("adminSession").find((s) => s.id === "b")?.revokedAt).toBeNull();
    expect(rows("adminSession").find((s) => s.id === "a")?.revokedAt).toEqual(NOW);
  });

  it("a monitoring failure never breaks sign-in", async () => {
    await expect(policyMod.onAdminSessionCreated({ adminId: "a1", sessionId: "x", ip: null, userAgent: null })).resolves.toBeUndefined();
  });
});

describe("step-up (password re-confirmation)", () => {
  it("requires a valid token bound to THIS administrator", async () => {
    await expect(policyMod.assertStepUp("a1", undefined)).rejects.toMatchObject({ status: 403 });
    await expect(policyMod.assertStepUp("a1", "garbage.token")).rejects.toMatchObject({ status: 403 });
    const mine = stepUp.issueStepUpToken("REAUTH", "a1", 60_000);
    await expect(policyMod.assertStepUp("a1", mine)).resolves.toBeUndefined();
    await expect(policyMod.assertStepUp("a2", mine)).rejects.toMatchObject({ status: 403 }); // someone else's token
    await expect(policyMod.assertStepUp("a1", stepUp.issueStepUpToken("LOGIN_2FA", "a1", 60_000))).rejects.toMatchObject({ status: 403 }); // wrong purpose
    await expect(policyMod.assertStepUp("a1", stepUp.issueStepUpToken("REAUTH", "a1", -1000))).rejects.toMatchObject({ status: 403 }); // expired
  });

  it("can be switched off in the configuration", async () => {
    setPolicy({ stepUpForHighRisk: false });
    await expect(policyMod.assertStepUp("a1", undefined)).resolves.toBeUndefined();
  });
});

describe("MFA coverage", () => {
  beforeEach(() => {
    rows("adminUser").push(
      { id: "u1", name: "Owner", role: "SUPER", customRoleId: null, active: true, twoFactorEnabled: true },
      { id: "u2", name: "Second", role: "SUPER", customRoleId: null, active: true, twoFactorEnabled: false },
      { id: "u3", name: "Manager", role: "MANAGER", customRoleId: null, active: true, twoFactorEnabled: false },
      { id: "u4", name: "Gone", role: "SUPER", customRoleId: null, active: false, twoFactorEnabled: false },
    );
    rows("appSettings").push({ id: 1, twoFactorRequiredRoles: [] });
  });

  it("lists privileged, active administrators with no second step — and nobody else", async () => {
    const c = await sec.mfaCoverage();
    expect(c).toMatchObject({ privilegedTotal: 2, covered: 1 });
    expect(c.gaps).toEqual([{ adminId: "u2", name: "Second", role: "SUPER", reason: expect.stringContaining("No second step") }]);
  });

  it("counts a role on the existing required list, and enforcement for privileged roles, as covered", async () => {
    rows("appSettings")[0].twoFactorRequiredRoles = ["SUPER"];
    expect((await sec.mfaCoverage()).gaps).toHaveLength(0);
    rows("appSettings")[0].twoFactorRequiredRoles = [];
    setPolicy({ enforceMfaPrivileged: true });
    expect((await sec.mfaCoverage())).toMatchObject({ gaps: [], policy: { enforceMfaPrivileged: true } });
  });

  it("sign-in asks privileged people for the code only when enforcement is on (fail-open otherwise)", async () => {
    expect(await sec.mfaEnforcedFor({ role: "SUPER", customRoleId: null })).toBe(false);
    setPolicy({ enforceMfaPrivileged: true });
    expect(await sec.mfaEnforcedFor({ role: "SUPER", customRoleId: null })).toBe(true);
    expect(await sec.mfaEnforcedFor({ role: "MANAGER", customRoleId: null })).toBe(false);
  });
});

describe("read models", () => {
  it("active sessions mask addresses and omit ended ones", async () => {
    rows("adminUser").push({ id: "u1", name: "Owner", role: "SUPER" });
    rows("adminSession").push(
      { id: "s1", adminId: "u1", deviceInfo: "Chrome on Windows", ipAddress: "203.0.113.77", lastActiveAt: ago(5), createdAt: ago(60), expiresAt: new Date(NOW.getTime() + 1e9), revokedAt: null },
      { id: "s2", adminId: "u1", deviceInfo: "Old", ipAddress: "198.51.100.1", lastActiveAt: ago(500), createdAt: ago(900), expiresAt: new Date(NOW.getTime() + 1e9), revokedAt: ago(100) },
    );
    const list = await sec.activeAdminSessions();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "s1", adminName: "Owner", ip: "203.0.113.…" });
    expect(JSON.stringify(list)).not.toContain("203.0.113.77");
  });

  it("privilege changes list the action, the actor and the target — not the full audit record", async () => {
    rows("auditLog").push(
      { id: "l1", action: "ADMIN_USER_ROLE_CHANGED", adminId: "u1", createdAt: new Date(), meta: JSON.stringify({ targetAdminId: "u9", secret: "must-not-appear" }) },
      { id: "l2", action: "PROFILE_UPDATED", adminId: "u1", createdAt: new Date(), meta: null },
    );
    const out = await sec.privilegeChanges(30);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ action: "ADMIN_USER_ROLE_CHANGED", actorId: "u1", targetId: "u9" });
    expect(JSON.stringify(out)).not.toContain("must-not-appear");
  });

  it("counts sign-in attempts by outcome", async () => {
    rows("adminLoginHistory").push({ id: "1", event: "SUCCESS", createdAt: new Date() }, { id: "2", event: "FAILURE", createdAt: new Date() }, { id: "3", event: "FAILURE", createdAt: new Date() }, { id: "4", event: "LOCKED", createdAt: new Date() });
    expect(await sec.loginSignals(7)).toMatchObject({ success: 1, failure: 2, locked: 1 });
  });
});

describe("the hooks are in place", () => {
  it("requireAdmin checks idle time BEFORE it refreshes the session", () => {
    const g = src("src/lib/route-guard.ts");
    expect(g).toMatch(/enforceIdleTimeout\(record\)/);
    expect(g.indexOf("enforceIdleTimeout(record)")).toBeLessThan(g.indexOf("lastActiveAt: new Date()"));
  });
  it("sign-in reports the new session, and the MFA decision consults the SOC enforcement", () => {
    expect(src("src/lib/auth.ts")).toMatch(/onAdminSessionCreated\(/);
    expect(src("src/lib/admin-login.ts")).toMatch(/mfaEnforcedFor\(/);
  });
});

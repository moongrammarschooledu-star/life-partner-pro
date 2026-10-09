import { beforeEach, describe, expect, it, vi } from "vitest";

// STEP 32 milestone 7 — the overview and the readiness verdict. The verdict is COMPUTED: these tests pin the rules that stop it from ever
// saying "ready" on missing evidence, and show that an empty system reports zeros and "none yet" rather than invented figures.

type Row = Record<string, unknown> & { id?: string | number };
const h = vi.hoisted(() => ({ fake: null as unknown as ReturnType<typeof import("@/test-utils/fake-prisma").createFakeDb> }));
const flags = new Set<string>();
const perms: Record<string, string[]> = { SUPER: ["admin:manage"], STAFF: ["profile:view"] };

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", async () => {
  const { createFakeDb } = await import("@/test-utils/fake-prisma");
  h.fake = createFakeDb({
    defaults: {
      systemControl: { backupsEnabled: true, backupStaleAfterHours: 48, backupDailyKeep: 7, backupWeeklyKeep: 4, backupMonthlyKeep: 6, rpoMinutes: 1440, rtoMinutes: 240, restoreTestStaleAfterDays: 30, slowQueryThresholdMs: 500 },
      socSettings: { version: 1, suppressionWindowMinutes: 240, escalateCriticalMinutes: 15, escalateHighMinutes: 60, escalateMediumMinutes: 480, sessionIdleMinutes: null, maxConcurrentSessions: null, stepUpForHighRisk: true, enforceMfaPrivileged: false, accessLogRetentionDays: 365, alertRetentionDays: 730, lastDetectionAt: null, lastDetectionSummary: null },
      socAlert: { status: "NEW", acknowledgedAt: null, incidentId: null },
      socIncident: { status: "DETECTED" },
    },
  });
  return { prisma: h.fake.prisma };
});
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/ops/feature-flags", () => ({ isFeatureEnabled: vi.fn(async (k: string) => flags.has(k)) }));
vi.mock("@/lib/effective-permissions", () => ({ resolveEffectivePermissions: vi.fn(async (a: { role: string }) => perms[a.role] ?? []) }));

const { computeReadiness } = await import("./readiness");
const { socOverview } = await import("./overview");
const { sweepSocRetention } = await import("./retention");
const { invalidateSystemControl } = await import("@/lib/ops/system-control");
const { invalidateSessionPolicy } = await import("./session-policy");

const rows = (t: string) => h.fake.rows(t);
const NOW = new Date("2026-10-09T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

const allGood = {
  now: NOW,
  flags: { socEnabled: true, detection: true, escalation: true },
  lastDetectionAt: ago(60),
  lastDetectionErrors: 0,
  backup: { health: "HEALTHY" as const, reasons: [] as string[] },
  restore: { hasProof: true, ageDays: 5, staleAfterDays: 30 },
  dr: { hasActivePlan: true, rpo: "MET" as const, rto: "MET" as const, testOverdue: false },
  openCriticalAlerts: 0, openHighAlerts: 0, openCriticalIncidents: 0, mfaGaps: 0, privilegedAdmins: 2, sessionIdleMinutes: 30, cspEnforced: true, backupCiphertextPublicUrls: false,
};

describe("the readiness verdict", () => {
  it("is PRODUCTION_READY only when every check passes", () => {
    const r = computeReadiness(allGood);
    expect(r.state).toBe("PRODUCTION_READY");
    expect(r.counts).toEqual({ PASS: r.checks.length, WARN: 0, FAIL: 0 });
  });

  it("any warning means READY_WITH_WARNINGS, and each warning names what to do", () => {
    for (const [name, override] of [
      ["no restore proof", { restore: { hasProof: false, ageDays: null, staleAfterDays: 30 } }],
      ["stale restore proof", { restore: { hasProof: true, ageDays: 90, staleAfterDays: 30 } }],
      ["no DR plan", { dr: { ...allGood.dr, hasActivePlan: false } }],
      ["objectives not measured", { dr: { ...allGood.dr, rpo: "NOT_MEASURED" as const } }],
      ["tests overdue", { dr: { ...allGood.dr, testOverdue: true } }],
      ["MFA gaps", { mfaGaps: 1 }],
      ["no idle timeout", { sessionIdleMinutes: null }],
      ["CSP report-only", { cspEnforced: false }],
      ["public ciphertext URLs", { backupCiphertextPublicUrls: true }],
      ["detection off", { flags: { ...allGood.flags, detection: false } }],
      ["detection never ran", { lastDetectionAt: null }],
      ["detection stale", { lastDetectionAt: ago(60 * 40) }],
      ["escalation off", { flags: { ...allGood.flags, escalation: false } }],
      ["backup warning", { backup: { health: "WARNING" as const, reasons: ["Not verified yet."] } }],
      ["open high alert", { openHighAlerts: 2 }],
    ] as const) {
      const r = computeReadiness({ ...allGood, ...(override as object) });
      expect(r.state, name).toBe("READY_WITH_WARNINGS");
      expect(r.checks.filter((c) => c.status === "WARN").every((c) => c.detail.length > 10), name).toBe(true);
    }
  });

  it("any failure means NOT_READY", () => {
    for (const [name, override] of [
      ["open critical alert", { openCriticalAlerts: 1 }],
      ["open critical incident", { openCriticalIncidents: 1 }],
      ["backups failed", { backup: { health: "FAILED" as const, reasons: ["The most recent backup attempt failed."] } }],
      ["no backup at all", { backup: { health: "NONE" as const, reasons: ["No completed database backup exists."] } }],
      ["RPO exceeded", { dr: { ...allGood.dr, rpo: "EXCEEDED" as const } }],
      ["RTO exceeded", { dr: { ...allGood.dr, rto: "EXCEEDED" as const } }],
      ["detection errors", { lastDetectionErrors: 2 }],
    ] as const) expect(computeReadiness({ ...allGood, ...(override as object) }).state, name).toBe("NOT_READY");
  });

  it("missing evidence is never a pass", () => {
    const blank = computeReadiness({
      ...allGood, flags: { socEnabled: false, detection: false, escalation: false }, lastDetectionAt: null,
      backup: { health: "WARNING", reasons: ["x"] }, restore: { hasProof: false, ageDays: null, staleAfterDays: 30 },
      dr: { hasActivePlan: false, rpo: "NOT_MEASURED", rto: "NOT_MEASURED", testOverdue: false }, sessionIdleMinutes: null, cspEnforced: false, backupCiphertextPublicUrls: true,
    });
    expect(blank.state).toBe("READY_WITH_WARNINGS");
    for (const key of ["DETECTION_RUNNING", "RESTORE_PROVEN", "DR_PLAN", "RPO", "RTO", "SESSION_POLICY", "CSP_ENFORCED", "BACKUP_STORAGE_PRIVATE"]) expect(blank.checks.find((c) => c.key === key)?.status, key).toBe("WARN");
  });
});

describe("the overview", () => {
  beforeEach(() => {
    h.fake.reset();
    flags.clear();
    invalidateSystemControl();
    invalidateSessionPolicy();
  });
  const ev = (eventType: string, createdAt = ago(30)) => rows("securityEvent").push({ id: `e${rows("securityEvent").length}`, eventType, createdAt });

  it("an empty system reports zeros and 'none yet', never invented figures", async () => {
    const o = await socOverview(NOW);
    expect(o.alerts).toMatchObject({ open: 0, unacknowledged: 0, newest: [] });
    expect(o.incidents).toMatchObject({ open: 0, newest: [] });
    expect(o.criticalAndHigh).toEqual({ alerts: 0, incidents: 0 });
    expect(o.signals24h.items.every((s) => s.count === 0)).toBe(true);
    expect(o.backups).toMatchObject({ health: "NONE", lastBackup: null, lastVerified: null });
    expect(o.restore).toMatchObject({ hasProof: false, lastProven: null });
    expect(o.disasterRecovery.measured).toMatchObject({ rpoMinutes: null, rtoMinutes: null });
    expect(o.disasterRecovery.comparison).toEqual({ rpo: "NOT_MEASURED", rto: "NOT_MEASURED" });
    expect(o.detection).toMatchObject({ enabled: false, lastRunAt: null });
    expect(o.readiness.state).toBe("NOT_READY"); // no backup exists
    expect(o.signals24h.source).toMatch(/SecurityEvent/);
  });

  it("counts what is really there, only within the window, and states each source", async () => {
    flags.add("soc.enabled"); flags.add("soc.detection.enabled");
    rows("socAlert").push({ id: "a1", alertCode: "LPP-SEC-ALERT-000001", title: "t", severity: "CRITICAL", status: "NEW", source: "SecurityEvent", createdAt: ago(5) }, { id: "a2", alertCode: "LPP-SEC-ALERT-000002", title: "t", severity: "MEDIUM", status: "ACKNOWLEDGED", acknowledgedAt: ago(1), source: "SecurityEvent", createdAt: ago(9) }, { id: "a3", alertCode: "x", title: "t", severity: "HIGH", status: "CLOSED", createdAt: ago(99) });
    rows("socIncident").push({ id: "i1", incidentCode: "LPP-INC-000001", title: "t", severity: "HIGH", status: "INVESTIGATING", category: "API_ATTACK", createdAt: ago(20) }, { id: "i2", status: "CLOSED", severity: "CRITICAL", createdAt: ago(900) });
    for (let i = 0; i < 4; i++) ev("LOGIN_FAILED");
    ev("LOGIN_FAILED", ago(60 * 30)); // outside the 24 h window
    ev("WEBHOOK_SIGNATURE_FAILURE");
    rows("adminLoginHistory").push({ id: "l1", event: "FAILURE", createdAt: ago(10) }, { id: "l2", event: "SUCCESS", createdAt: ago(10) });
    rows("adminSession").push({ id: "s1", revokedAt: null, expiresAt: new Date(NOW.getTime() + 1e9) }, { id: "s2", revokedAt: ago(5), expiresAt: new Date(NOW.getTime() + 1e9) });
    const o = await socOverview(NOW);
    expect(o.alerts).toMatchObject({ open: 2, unacknowledged: 1, bySeverity: { CRITICAL: 1, MEDIUM: 1, HIGH: 0 } });
    expect(o.alerts.newest.map((a) => a.alertCode)).toEqual(["LPP-SEC-ALERT-000001", "LPP-SEC-ALERT-000002"]);
    expect(o.incidents).toMatchObject({ open: 1, bySeverity: { HIGH: 1, CRITICAL: 0 } });
    expect(o.criticalAndHigh).toEqual({ alerts: 1, incidents: 1 });
    expect(o.signals24h.items.find((s) => s.key === "LOGIN_FAILED")?.count).toBe(4);
    expect(o.signals24h.items.find((s) => s.key === "WEBHOOK_SIGNATURE_FAILURE")?.count).toBe(1);
    expect(o.adminLogins24h).toMatchObject({ failure: 1, success: 1, locked: 0 });
    expect(o.adminSecurity.activeSessions).toBe(1);
    expect(o.detection.enabled).toBe(true);
    expect(o.readiness.checks.find((c) => c.key === "OPEN_CRITICAL")?.status).toBe("FAIL");
  });

  it("a healthy, verified, fresh backup is reported as such — and still cannot make the system 'production ready' without a proven restore", async () => {
    rows("backupRun").push({ id: "b1", backupCode: "LPP-BKP-000001", type: "DATABASE", status: "COMPLETED", trigger: "SCHEDULED", retentionClass: "DAILY", startedAt: ago(120), completedAt: ago(118), sizeBytes: 1, encrypted: true, separateStore: true, verifiedAt: ago(100), verificationStatus: "PASSED", storageUrl: "https://blob.example/secret", prunedAt: null });
    const o = await socOverview(NOW);
    expect(o.backups.health).toBe("HEALTHY");
    expect(o.disasterRecovery.measured.rpoMinutes).toBe(120);
    expect(o.disasterRecovery.comparison.rpo).toBe("MET");
    expect(o.readiness.state).toBe("READY_WITH_WARNINGS");
    expect(o.readiness.checks.find((c) => c.key === "RESTORE_PROVEN")?.status).toBe("WARN");
    expect(JSON.stringify(o)).not.toMatch(/blob\.example|storageUrl/);
  });
});

describe("retention of security-operations data", () => {
  beforeEach(() => { h.fake.reset(); });
  it("removes old access-log rows and old closed alerts that belong to no incident — and nothing that is evidence", async () => {
    const old = new Date(NOW.getTime() - 800 * 86_400_000);
    rows("socAccessLog").push({ id: "l-old", createdAt: new Date(NOW.getTime() - 400 * 86_400_000) }, { id: "l-new", createdAt: ago(60) });
    rows("socAlert").push(
      { id: "a-old-closed", status: "CLOSED", incidentId: null, updatedAt: old },
      { id: "a-old-fp", status: "FALSE_POSITIVE", incidentId: null, updatedAt: old },
      { id: "a-old-incident", status: "CLOSED", incidentId: "inc-1", updatedAt: old },
      { id: "a-old-open", status: "INVESTIGATING", incidentId: null, updatedAt: old },
      { id: "a-recent-closed", status: "CLOSED", incidentId: null, updatedAt: ago(100) },
    );
    rows("socIncident").push({ id: "inc-1", createdAt: old });
    rows("socRuleVersion").push({ id: "rv1" });
    const out = await sweepSocRetention(NOW);
    expect(out).toEqual({ accessLogsDeleted: 1, alertsDeleted: 2 });
    expect(rows("socAccessLog").map((r) => r.id)).toEqual(["l-new"]);
    expect(rows("socAlert").map((r) => r.id).sort()).toEqual(["a-old-incident", "a-old-open", "a-recent-closed"]);
    expect(rows("socIncident")).toHaveLength(1);
    expect(rows("socRuleVersion")).toHaveLength(1);
    expect(rows("retentionActionLog")[0]).toMatchObject({ category: "SOC_ACCESS_DATA", action: "DELETE", outcome: "APPLIED" });
  });
  it("logs nothing when there is nothing to delete", async () => {
    expect(await sweepSocRetention(NOW)).toEqual({ accessLogsDeleted: 0, alertsDeleted: 0 });
    expect(rows("retentionActionLog")).toHaveLength(0);
  });
});

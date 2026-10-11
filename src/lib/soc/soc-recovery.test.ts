import { beforeEach, describe, expect, it, vi } from "vitest";

// STEP 32 milestone 6 — backups, restore drills and disaster recovery. The point of these tests is honesty: a backup is "healthy" only on
// evidence, a restore counts as proven only when a second person signed off a drill that passed every item, locations never leave the
// module, and configured objectives are never mistaken for measured results.

type Row = Record<string, unknown> & { id?: string | number };
const h = vi.hoisted(() => ({ fake: null as unknown as ReturnType<typeof import("@/test-utils/fake-prisma").createFakeDb> }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", async () => {
  const { createFakeDb } = await import("@/test-utils/fake-prisma");
  h.fake = createFakeDb({
    defaults: {
      systemControl: { backupsEnabled: true, backupStaleAfterHours: 48, backupDailyKeep: 7, backupWeeklyKeep: 4, backupMonthlyKeep: 6, rpoMinutes: 1440, rtoMinutes: 240, slowQueryThresholdMs: 500 },
      restoreDrill: { reviewedById: null, reviewedAt: null, reviewNote: null, completedAt: null, durationSeconds: null, failureNote: null },
      disasterRecoveryPlan: { approvedById: null, approvedAt: null, testEveryDays: null },
    },
    unique: { disasterRecoveryPlan: ["version"] },
  });
  return { prisma: h.fake.prisma };
});

const audits: Row[] = [];
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));

const backups = await import("./backups");
const drills = await import("./restore-drills");
const dr = await import("./disaster-recovery");
const { invalidateSystemControl } = await import("@/lib/ops/system-control");

const rows = (t: string) => h.fake.rows(t);
const NOW = new Date("2026-10-09T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
const run = (over: Row = {}) => rows("backupRun").push({ id: `b-${rows("backupRun").length + 1}`, backupCode: `LPP-BKP-00000${rows("backupRun").length + 1}`, type: "DATABASE", trigger: "SCHEDULED", status: "COMPLETED", retentionClass: "DAILY", startedAt: ago(60), completedAt: ago(58), sizeBytes: 1000, encrypted: true, separateStore: true, verifiedAt: ago(50), verificationStatus: "PASSED", failureReason: null, storageUrl: "https://blob.example/private-bucket/abc123secret", prunedAt: null, ...over });

beforeEach(() => {
  h.fake.reset();
  audits.length = 0;
  invalidateSystemControl();
});

describe("backup health is claimed only on evidence", () => {
  const base = { backupsEnabled: true, staleAfterHours: 48, now: NOW, latestAttempt: null as never, latestCompleted: null as never };
  const good = { startedAt: ago(60), verificationStatus: "PASSED" };
  it("covers every state", () => {
    expect(backups.backupHealth({ ...base, backupsEnabled: false }).health).toBe("DISABLED");
    expect(backups.backupHealth(base).health).toBe("NONE");
    expect(backups.backupHealth({ ...base, latestCompleted: good, latestAttempt: { status: "COMPLETED", startedAt: good.startedAt } })).toEqual({ health: "HEALTHY", reasons: [] });
    expect(backups.backupHealth({ ...base, latestCompleted: { ...good, verificationStatus: null } }).health).toBe("WARNING");
    expect(backups.backupHealth({ ...base, latestCompleted: { ...good, verificationStatus: "FAILED" } }).health).toBe("FAILED");
    expect(backups.backupHealth({ ...base, latestCompleted: good, latestAttempt: { status: "FAILED", startedAt: ago(10) } })).toMatchObject({ health: "FAILED", reasons: ["The most recent backup attempt failed."] });
    const stale = backups.backupHealth({ ...base, latestCompleted: { startedAt: ago(60 * 60), verificationStatus: "PASSED" } });
    expect(stale.health).toBe("WARNING");
    expect(stale.reasons[0]).toMatch(/60 hours old \(limit 48 hours\)/);
  });
  it("an older failed attempt does not mask a newer good backup", () => {
    expect(backups.backupHealth({ ...base, latestCompleted: good, latestAttempt: { status: "FAILED", startedAt: ago(600) } }).health).toBe("HEALTHY");
  });
});

describe("the backup overview never reveals where backups are kept", () => {
  it("reduces a location to off-site yes/no and returns no storage fields", async () => {
    run();
    run({ id: "local", type: "FILES", storageUrl: "file:///tmp/backups/x", status: "COMPLETED" });
    const o = await backups.backupOverview(NOW);
    const json = JSON.stringify(o);
    expect(json).not.toMatch(/storageUrl|blob\.example|private-bucket|abc123secret|file:\/\//);
    expect(o.health).toBe("HEALTHY");
    expect(o.storage).toMatchObject({ encrypted: true, offsite: true, separateStore: true });
    expect(o.recent.find((r) => r.id === "local")?.storedOffsite).toBe(false);
    expect(o.verificationNote).toMatch(/NOT proof that a restore works/);
  });
  it("with no backup it says so, rather than showing a healthy empty state", async () => {
    expect(await backups.backupOverview(NOW)).toMatchObject({ health: "NONE", latestDatabase: null, lastVerified: null });
  });
  it("a failed latest backup is reported as failed with its reason code", async () => {
    run({ startedAt: ago(300) });
    run({ status: "FAILED", startedAt: ago(30), verificationStatus: null, failureReason: "Out of memory" });
    expect(await backups.backupOverview(NOW)).toMatchObject({ health: "FAILED" });
  });
});

describe("restore drills (pure rules)", () => {
  const items = (status: "PASSED" | "FAILED" | "NOT_RUN", n = 8) => drills.DRILL_ITEMS.slice(0, n).map((i) => ({ key: i.key, status, note: "checked" }));
  it("has the eight checks the spec lists", () => {
    expect(drills.DRILL_ITEMS.map((i) => i.key)).toEqual(["DATABASE_RESTORE", "FILE_RESTORE", "RELATIONSHIPS", "MIGRATION_COMPATIBILITY", "APPLICATION_STARTUP", "AUTHENTICATION", "CRITICAL_WORKFLOWS", "DATA_INTEGRITY"]);
  });
  it("cannot complete with anything not run; passes only if all passed AND the automated verify passed", () => {
    expect(drills.completionVerdict([...items("PASSED", 7), { key: "DATA_INTEGRITY", status: "NOT_RUN", note: "" }], true)).toMatchObject({ ok: false });
    expect(drills.completionVerdict(items("PASSED"), true)).toEqual({ ok: true, status: "PASSED" });
    expect(drills.completionVerdict(items("PASSED"), false)).toEqual({ ok: true, status: "FAILED" });
    expect(drills.completionVerdict(items("PASSED"), null)).toEqual({ ok: true, status: "FAILED" });
    expect(drills.completionVerdict([...items("PASSED", 7), { key: "DATA_INTEGRITY", status: "FAILED", note: "x" }], true)).toEqual({ ok: true, status: "FAILED" });
  });
  it("proof needs PASSED + a reviewer who is not the performer", () => {
    const d = { status: "PASSED" as const, performedById: "p", reviewedById: "r", reviewedAt: NOW };
    expect(drills.isProof(d)).toBe(true);
    expect(drills.isProof({ ...d, reviewedById: null, reviewedAt: null })).toBe(false);
    expect(drills.isProof({ ...d, reviewedById: "p" })).toBe(false);
    expect(drills.isProof({ ...d, status: "FAILED" as never })).toBe(false);
  });
});

describe("restore drills (flow)", () => {
  const verifyOk = vi.fn(async () => ({ passed: true, checks: [1, 2, 3, 4, 5], testId: "t1" }));
  const verifyBad = vi.fn(async () => ({ passed: false, checks: [1, 2], testId: "t2" }));
  const start = (over: Partial<Parameters<typeof drills.startDrill>[1]> = {}, verify = verifyOk) => drills.startDrill("perf-1", { backupId: "b-1", environmentLabel: "neon-branch restore-test", isolatedConfirmed: true, ...over }, verify);
  const passAll = async (id: string) => { for (const i of drills.DRILL_ITEMS) await drills.recordItem("perf-1", id, i.key, "PASSED", "verified by hand"); };

  beforeEach(() => { run(); verifyOk.mockClear(); });

  it("starts only against an isolated environment and a completed database backup, and runs the real verification", async () => {
    await expect(start({ environmentLabel: "production" })).rejects.toMatchObject({ status: 422 });
    await expect(start({ environmentLabel: "live database copy" })).rejects.toMatchObject({ status: 422 });
    await expect(start({ environmentLabel: "ab" })).rejects.toMatchObject({ status: 422 });
    await expect(start({ isolatedConfirmed: false })).rejects.toMatchObject({ status: 422 });
    await expect(start({ backupId: "ghost" })).rejects.toMatchObject({ status: 404 });
    rows("backupRun").push({ id: "files-1", type: "FILES", status: "COMPLETED", backupCode: "LPP-BKP-F" });
    await expect(start({ backupId: "files-1" })).rejects.toMatchObject({ status: 409 });
    expect(verifyOk).not.toHaveBeenCalled(); // nothing was verified for a refused drill
    const d = await start();
    expect(d).toMatchObject({ status: "IN_PROGRESS", performedById: "perf-1", backupCode: "LPP-BKP-000001", environmentLabel: "neon-branch restore-test" });
    expect(d.verifySummary).toMatchObject({ passed: true, checks: 5, isolatedConfirmed: true });
    expect((d.items as unknown[]).every((i) => (i as { status: string }).status === "NOT_RUN")).toBe(true);
    await expect(start()).rejects.toMatchObject({ status: 409 }); // one at a time per person
  });

  it("only the performer records results; a failure needs words; an unknown item is refused", async () => {
    const d = await start();
    await expect(drills.recordItem("other", d.id as string, "DATABASE_RESTORE", "PASSED", "looked fine")).rejects.toMatchObject({ status: 403 });
    await expect(drills.recordItem("perf-1", d.id as string, "NOPE", "PASSED", "looked fine")).rejects.toMatchObject({ status: 422 });
    await expect(drills.recordItem("perf-1", d.id as string, "FILE_RESTORE", "FAILED", "bad")).rejects.toMatchObject({ status: 422 });
    await expect(drills.recordItem("perf-1", d.id as string, "FILE_RESTORE", "PASSED", "")).rejects.toMatchObject({ status: 422 });
    await drills.recordItem("perf-1", d.id as string, "FILE_RESTORE", "FAILED", "Photos did not download after restore");
    expect((rows("restoreDrill")[0].items as Array<{ key: string; status: string }>).find((i) => i.key === "FILE_RESTORE")?.status).toBe("FAILED");
  });

  it("cannot be completed with items not run; a clean drill passes; times are recorded", async () => {
    const d = await start();
    await expect(drills.completeDrill("perf-1", d.id as string)).rejects.toMatchObject({ status: 422 });
    await passAll(d.id as string);
    await expect(drills.completeDrill("other", d.id as string)).rejects.toMatchObject({ status: 403 });
    const done = await drills.completeDrill("perf-1", d.id as string, undefined, new Date(Date.now() + 95 * 60_000));
    expect(done).toMatchObject({ status: "PASSED", failureNote: null });
    expect(done.durationSeconds).toBeGreaterThanOrEqual(95 * 60 - 5);
    expect(done.completedAt).toBeInstanceOf(Date);
    await expect(drills.recordItem("perf-1", d.id as string, "DATA_INTEGRITY", "FAILED", "changing history now")).rejects.toMatchObject({ status: 409 });
  });

  it("a failed automated verification makes the drill FAILED however the checklist went, and it must say why", async () => {
    const d = await start({}, verifyBad);
    await passAll(d.id as string);
    await expect(drills.completeDrill("perf-1", d.id as string)).rejects.toMatchObject({ status: 422 });
    const done = await drills.completeDrill("perf-1", d.id as string, "The automated verification of the backup failed.");
    expect(done.status).toBe("FAILED");
  });

  it("only a DIFFERENT person can review; only a passed drill can be approved; a rejection turns it into FAILED", async () => {
    const d = await start();
    await expect(drills.reviewDrill("rev-1", d.id as string, "APPROVE", "Looks right")).rejects.toMatchObject({ status: 409 }); // not complete
    await passAll(d.id as string);
    await drills.completeDrill("perf-1", d.id as string);
    await expect(drills.reviewDrill("perf-1", d.id as string, "APPROVE", "Approving my own drill")).rejects.toMatchObject({ status: 403 });
    await expect(drills.reviewDrill("rev-1", d.id as string, "APPROVE", "")).rejects.toMatchObject({ status: 422 });
    const ok = await drills.reviewDrill("rev-1", d.id as string, "APPROVE", "Reviewed the evidence and the notes");
    expect(ok).toMatchObject({ reviewedById: "rev-1", status: "PASSED" });
    await expect(drills.reviewDrill("rev-2", d.id as string, "REJECT", "Second review attempt")).rejects.toMatchObject({ status: 409 });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["SOC_RESTORE_DRILL_RECORDED", "SOC_RESTORE_DRILL_REVIEWED"]));

    const d2 = await drills.startDrill("perf-2", { backupId: "b-1", environmentLabel: "second-scratch-db", isolatedConfirmed: true }, verifyOk);
    for (const i of drills.DRILL_ITEMS) await drills.recordItem("perf-2", d2.id as string, i.key, "PASSED", "verified by hand");
    await drills.completeDrill("perf-2", d2.id as string);
    const rej = await drills.reviewDrill("rev-1", d2.id as string, "REJECT", "Evidence for the workflows step is missing");
    expect(rej.status).toBe("FAILED");
    expect(rej.failureNote).toMatch(/Review rejected/);
  });

  it("restore is 'proven' only by a passed, independently reviewed drill", async () => {
    expect(await drills.restoreProof(NOW)).toMatchObject({ hasProof: false, lastProven: null, lastAttempt: null });
    const d = await start();
    await passAll(d.id as string);
    await drills.completeDrill("perf-1", d.id as string);
    expect((await drills.restoreProof()).hasProof).toBe(false); // passed but not reviewed
    await drills.reviewDrill("rev-1", d.id as string, "APPROVE", "Reviewed the evidence and the notes");
    const p = await drills.restoreProof();
    expect(p.hasProof).toBe(true);
    expect(p.lastProven).toMatchObject({ drillId: d.id, environmentLabel: "neon-branch restore-test" });
  });
});

describe("the disaster-recovery plan", () => {
  const good = { procedures: [{ title: "Restore the database", detail: "Create a Neon branch, run scripts/restore-backup.ts against it, then point the app at it." }], contacts: [{ title: "Owner", detail: "Reachable by phone; see the contact sheet in the password manager" }], providers: [{ title: "Neon (database)", detail: "Dashboard → Branches" }] };

  it("accepts ordinary content, fills missing sections with empty lists", () => {
    const v = dr.validatePlanSections(good);
    expect(v.ok).toBe(true);
    if (v.ok) expect(Object.keys(v.sections)).toEqual([...dr.PLAN_SECTIONS]);
  });

  it("refuses anything that looks like a secret, an unknown section, or too many entries", () => {
    for (const bad of [
      { procedures: [{ title: "Database login", detail: "password: hunter2hunter2" }] },
      { procedures: [{ title: "Key", detail: ["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc4eC39HqLyjWDarjt"].join("_") /* built at run time so no source file holds a key-shaped literal */ }] },
      { procedures: [{ title: "Token", detail: "api_key=abc" }] },
      { secrets: [] },
      { procedures: "not a list" },
      { procedures: Array.from({ length: 31 }, (_, i) => ({ title: `Step ${i + 1}`, detail: "" })) },
      { procedures: [{ title: "x", detail: "" }] },
    ]) expect(dr.validatePlanSections(bad).ok, JSON.stringify(bad).slice(0, 60)).toBe(false);
  });

  it("compares a target with a measurement, and never calls an unmeasured target met", () => {
    expect(dr.compare(240, 100)).toBe("MET");
    expect(dr.compare(240, 240)).toBe("MET");
    expect(dr.compare(240, 241)).toBe("EXCEEDED");
    expect(dr.compare(240, null)).toBe("NOT_MEASURED");
  });

  it("versions the plan; a draft needs approval by someone other than its author; approval supersedes the old one", async () => {
    await expect(dr.createPlanDraft("author-1", { sections: good, reason: "x" })).rejects.toMatchObject({ status: 422 });
    await expect(dr.createPlanDraft("author-1", { sections: good, testEveryDays: 3, reason: "First plan" })).rejects.toMatchObject({ status: 422 });
    const v1 = await dr.createPlanDraft("author-1", { sections: good, testEveryDays: 90, reason: "First written plan" });
    expect(v1).toMatchObject({ version: 1, status: "DRAFT" });
    await expect(dr.createPlanDraft("author-1", { sections: good, reason: "Another draft" })).rejects.toMatchObject({ status: 409 });
    await expect(dr.approvePlan("author-1", 1)).rejects.toMatchObject({ status: 403 });
    await expect(dr.approvePlan("rev-1", 9)).rejects.toMatchObject({ status: 404 });
    await dr.approvePlan("rev-1", 1);
    expect((await dr.activePlan())?.version).toBe(1);
    await dr.createPlanDraft("author-2", { sections: good, testEveryDays: 60, reason: "Add the provider list" });
    await dr.approvePlan("rev-1", 2);
    expect(rows("disasterRecoveryPlan").map((p) => `${p.version}:${p.status}`)).toEqual(["1:SUPERSEDED", "2:ACTIVE"]);
    await expect(dr.approvePlan("rev-1", 2)).rejects.toMatchObject({ status: 409 });
  });

  it("records tests with a real date and findings", async () => {
    await expect(dr.recordTest("u", { testType: "TABLETOP", status: "COMPLETED", performedAt: new Date(Date.now() + 86_400_000), findings: "A walkthrough of the plan" })).rejects.toMatchObject({ status: 422 });
    await expect(dr.recordTest("u", { testType: "TABLETOP", status: "COMPLETED", performedAt: new Date(Date.now() - 600_000), findings: "short" })).rejects.toMatchObject({ status: 422 });
    await expect(dr.recordTest("u", { testType: "RESTORE", status: "COMPLETED", performedAt: new Date(Date.now() - 600_000), findings: "Restore drill recorded", drillId: "ghost" })).rejects.toMatchObject({ status: 422 });
    const t = await dr.recordTest("u", { testType: "TABLETOP", status: "COMPLETED", performedAt: new Date(Date.now() - 600_000), durationMinutes: 45, findings: "Walked through the database failure scenario" });
    expect(t).toMatchObject({ testType: "TABLETOP", status: "COMPLETED", durationMinutes: 45, planVersion: null });
  });
});

describe("configured and measured recovery numbers stay apart", () => {
  it("with no evidence the measured side is empty and nothing is called met", async () => {
    const o = await dr.drOverview(NOW);
    expect(o.configured).toMatchObject({ rtoMinutes: 240, rpoMinutes: 1440 });
    expect(o.measured).toMatchObject({ rpoMinutes: null, rtoMinutes: null });
    expect(o.comparison).toEqual({ rpo: "NOT_MEASURED", rto: "NOT_MEASURED" });
    expect(o.plan).toBeNull();
    expect(o.restoreProof.hasProof).toBe(false);
  });

  it("measures RPO from the newest VERIFIED backup and RTO from the latest APPROVED drill", async () => {
    run({ startedAt: ago(100), verificationStatus: "PASSED" });
    run({ startedAt: ago(10), verificationStatus: null }); // newer but unverified: ignored for RPO
    rows("restoreDrill").push({ id: "d1", backupId: "b-1", backupCode: "LPP-BKP-000001", environmentLabel: "scratch-1", status: "PASSED", performedById: "p", reviewedById: "r", reviewedAt: ago(30), completedAt: ago(40), durationSeconds: 90 * 60, startedAt: ago(140) });
    const o = await dr.drOverview(NOW);
    expect(o.measured).toMatchObject({ rpoMinutes: 100, rtoMinutes: 90 });
    expect(o.comparison).toEqual({ rpo: "MET", rto: "MET" });
    expect(o.configured).toMatchObject({ rtoMinutes: 240, rpoMinutes: 1440 }); // unchanged by the measurement
  });

  it("an unreviewed drill does not measure RTO, and a slow restore is reported as exceeding the target", async () => {
    run();
    rows("restoreDrill").push({ id: "d1", status: "PASSED", performedById: "p", reviewedById: null, reviewedAt: null, completedAt: ago(40), durationSeconds: 60, startedAt: ago(140), environmentLabel: "scratch-1" });
    expect((await dr.drOverview(NOW)).measured.rtoMinutes).toBeNull();
    rows("restoreDrill")[0].reviewedById = "r";
    rows("restoreDrill")[0].reviewedAt = ago(30);
    rows("restoreDrill")[0].durationSeconds = 300 * 60;
    expect((await dr.drOverview(NOW))).toMatchObject({ measured: { rtoMinutes: 300 }, comparison: { rto: "EXCEEDED" } });
  });

  it("flags an overdue recovery test against the plan's schedule", async () => {
    await dr.createPlanDraft("a", { sections: { procedures: [{ title: "Restore", detail: "" }] }, testEveryDays: 30, reason: "Plan with a schedule" });
    await dr.approvePlan("b", 1);
    expect((await dr.drOverview(NOW)).tests.overdue).toBe(true); // a schedule exists but no test has ever been recorded
    rows("disasterRecoveryTest").push({ id: "t1", status: "COMPLETED", performedAt: ago(10 * 24 * 60), testType: "TABLETOP" });
    expect((await dr.drOverview(NOW)).tests).toMatchObject({ overdue: false, everyDays: 30 });
    rows("disasterRecoveryTest")[0].performedAt = ago(40 * 24 * 60);
    expect((await dr.drOverview(NOW)).tests.overdue).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { evaluateReadiness, CATEGORIES, type ReadinessFacts } from "./gates";

const ev = (age = 0.1) => ({ status: "PASS" as const, ageDays: age });
const allEvidence = Object.fromEntries(["BUILD", "TYPECHECK", "LINT", "TESTS", "SECURITY_SCAN", "DEPENDENCY_AUDIT", "MIGRATION_VALIDATION", "SMOKE", "SECURITY_SMOKE", "SMOKE_AUTH", "LOAD_TEST"].map((k) => [k, ev()]));

// A fully green production environment — every required gate has positive evidence.
const green: ReadinessFacts = {
  appEnv: "production",
  configIssues: [],
  evidence: allEvidence,
  evidenceMaxAgeDays: 7,
  health: { dbOk: true, overall: "ok", ready: true },
  migrations: { tracked: true, applied: 3, failed: 0 },
  headers: { probed: true, https: true, hsts: true, nosniff: true, csp: "enforce", poweredBy: false },
  rateLimitProbeOk: true,
  stateEndpointOk: true,
  backup: { enabled: true, keyConfigured: true, separateStore: true, lastSuccessAgeHours: 3, backupStaleAfterHours: 48, lastVerifiedPassed: true, failedCount: 0, restoreTestStatus: "PASSED", restoreTestAgeDays: 1, restoreTestStaleAfterDays: 30, fileSources: 4, fileMirrored: 4, fileLastRunFailed: false },
  jobs: { workerStatus: "SUCCESS", workerAgeHours: 2, alertEvalAgeHours: 2, deadLetter: 0, tickConsecutiveFailures: 0 },
  alerts: { openCritical: 0 },
  integrity: { status: "CLEAN", ageDays: 0.5, highFindings: 0 },
  payments: { provider: "MANUAL", activeBankAccounts: 1, stage: "PRODUCTION", envSafe: true, checklist: { successfulPayment: true, failedPayment: true, cancelledOrder: true, completedRefund: true, processedWebhookEvent: false, activeSubscription: true, invoiceGenerated: true }, reconciliationClean: true, killSwitchExercised: true, webhooksEnabled: true },
  comms: { email: true, sms: true, whatsappEnabled: false, whatsappConfigured: false },
  security: { twoFactorRoles: ["SUPER_ADMIN", "ADMIN"], adminSessionMaxHours: 12, legacyUnencryptedPhotos: 0, lockoutConfigured: true },
  release: { hasCurrent: true, healthy: true, approved: true, hasRollbackTarget: true },
  selfTest: { status: "PASS", ageDays: 1 },
  storage: { tokenConfigured: true },
  performance: { slowQueryRows24h: 0 },
  drTargetsConfigured: true,
};

const blockedIds = (f: ReadinessFacts) => evaluateReadiness(f).gates.filter((g) => g.required && g.status !== "PASS").map((g) => g.id);

describe("evaluateReadiness", () => {
  it("is READY only when every required gate passes", () => {
    const r = evaluateReadiness(green);
    expect(r.unresolved).toEqual([]);
    expect(r.verdict).toBe("READY");
  });

  it("is NOT READY on a completely empty environment and lists exact unresolved items", () => {
    const empty: ReadinessFacts = {
      ...green,
      evidence: {},
      migrations: { tracked: false, applied: 0, failed: 0 },
      headers: { probed: false, https: false, hsts: false, nosniff: false, csp: "none", poweredBy: false },
      backup: { ...green.backup, keyConfigured: false, lastSuccessAgeHours: null, lastVerifiedPassed: false, restoreTestStatus: null, restoreTestAgeDays: null },
      selfTest: { status: null, ageDays: null },
      release: { hasCurrent: false, healthy: false, approved: false, hasRollbackTarget: false },
      payments: { ...green.payments, checklist: {}, reconciliationClean: null, killSwitchExercised: false },
      comms: { ...green.comms, email: false },
      integrity: { status: null, ageDays: null, highFindings: 0 },
      jobs: { workerStatus: null, workerAgeHours: null, alertEvalAgeHours: null, deadLetter: 0, tickConsecutiveFailures: 0 },
    };
    const r = evaluateReadiness(empty);
    expect(r.verdict).toBe("NOT READY");
    expect(r.unresolved.length).toBeGreaterThan(10);
    expect(r.unresolved.some((u) => u.includes("Recent successful backup"))).toBe(true);
  });

  it("never passes a gate without evidence (missing / failed / stale CI evidence all block)", () => {
    expect(blockedIds({ ...green, evidence: { ...allEvidence, TESTS: undefined } })).toContain("tests");
    expect(blockedIds({ ...green, evidence: { ...allEvidence, BUILD: { status: "FAIL", ageDays: 0 } } })).toContain("build");
    expect(blockedIds({ ...green, evidence: { ...allEvidence, LINT: ev(30) } })).toContain("lint");
  });

  it("blocks on environment mixing / missing labels and on critical config", () => {
    const mixed = blockedIds({ ...green, configIssues: [{ severity: "CRITICAL", key: "DATABASE_ENV_LABEL", message: "mismatch" }] });
    expect(mixed).toEqual(expect.arrayContaining(["db_env_label", "critical_config"]));
    const missing = blockedIds({ ...green, configIssues: [{ severity: "BLOCKER", key: "STORAGE_ENV_LABEL", message: "missing" }] });
    expect(missing).toEqual(expect.arrayContaining(["storage_env_label", "env_separation"]));
  });

  it("requires a restore-verified backup, not just a backup file", () => {
    expect(blockedIds({ ...green, backup: { ...green.backup, lastVerifiedPassed: false } })).toContain("backup_verified");
    expect(blockedIds({ ...green, backup: { ...green.backup, restoreTestStatus: "FAILED" } })).toEqual(expect.arrayContaining(["restore_test", "dr_restore_proven"]));
    expect(blockedIds({ ...green, backup: { ...green.backup, restoreTestAgeDays: 90 } })).toContain("restore_test");
  });

  it("does not let a Manual-only setup pass the provider gate without a bank account", () => {
    expect(blockedIds({ ...green, payments: { ...green.payments, activeBankAccounts: 0 } })).toContain("pay_provider");
  });

  it("requires real payment evidence: flows, refund, kill switch, reconciliation", () => {
    const ids = blockedIds({ ...green, payments: { ...green.payments, checklist: { ...green.payments.checklist, completedRefund: false }, killSwitchExercised: false, reconciliationClean: false } });
    expect(ids).toEqual(expect.arrayContaining(["pay_flows", "pay_refund", "pay_kill_switch", "pay_reconciliation"]));
  });

  it("requires webhook verification only for non-manual providers", () => {
    expect(blockedIds(green)).not.toContain("pay_webhook");
    expect(blockedIds({ ...green, payments: { ...green.payments, provider: "STRIPE" } })).toContain("pay_webhook");
  });

  it("blocks on unencrypted legacy photos, open critical alerts and missing 2FA", () => {
    expect(blockedIds({ ...green, security: { ...green.security, legacyUnencryptedPhotos: 2 } })).toContain("legacy_photos");
    expect(blockedIds({ ...green, alerts: { openCritical: 1 } })).toContain("monitor_criticals");
    expect(blockedIds({ ...green, security: { ...green.security, twoFactorRoles: ["SUPER_ADMIN"] } })).toContain("admin_2fa");
  });

  it("warns (but does not block) for optional gates", () => {
    const r = evaluateReadiness({ ...green, headers: { ...green.headers, csp: "report-only" }, backup: { ...green.backup, separateStore: false }, comms: { ...green.comms, sms: false } });
    expect(r.verdict).toBe("READY");
    expect(r.gates.find((g) => g.id === "csp_enforced")?.status).toBe("WARN");
    expect(r.gates.find((g) => g.id === "backup_separate_store")?.status).toBe("WARN");
    expect(r.scorecard.find((s) => s.category === "Communication")?.status).toBe("PASS WITH WARNINGS");
  });

  it("produces one scorecard row per required category with exact blocking reasons and no numeric score", () => {
    const r = evaluateReadiness({ ...green, evidence: {} });
    expect(r.scorecard.map((s) => s.category)).toEqual([...CATEGORIES]);
    const app = r.scorecard.find((s) => s.category === "Application")!;
    expect(app.status).toBe("BLOCKED");
    expect(app.blocking.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.scorecard)).not.toMatch(/"score"/);
  });

  it("does not require production-only gates outside production", () => {
    const stagingIds = blockedIds({ ...green, appEnv: "staging", headers: { probed: false, https: false, hsts: false, nosniff: false, csp: "none", poweredBy: false }, release: { ...green.release, approved: false } });
    expect(stagingIds).not.toContain("https");
    expect(stagingIds).not.toContain("release_approved");
  });
});

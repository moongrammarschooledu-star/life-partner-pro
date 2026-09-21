import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/ai/testing/fake-db")).prisma }));
vi.mock("@/lib/route-guard", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock("@/lib/audit", async () => ({
  writeAudit: async (p: { action: string; adminId?: string | null; meta?: Record<string, unknown> }) => {
    (await import("@/lib/ai/testing/fake-db")).state.audits.push(p);
  },
}));
vi.mock("@/lib/ops/feature-flags", async () => ({ getAllFeatureFlags: async () => (await import("@/lib/ai/testing/fake-db")).state.flags }));

import { runRuntimeSuite, RUNTIME_CHECK_COUNT } from "@/lib/ai/testing/suite";
import { validTransition, classifyHealth, configPatchSchema, runTests, updateConfig, setRolloutPhase, setKillSwitch, latestPassingRun } from "@/lib/ai/admin";
import { invalidateAiConfig } from "@/lib/ai/config";
import { evaluateAlertRules, type MetricsSnapshot, type AlertThresholds } from "@/lib/ops/alert-rules";
import { incidentCategoryFor } from "@/lib/ops/incident-mapping";
import { allPromptChecksums } from "@/lib/ai/prompts";
import { state, resetState, admin, setConfig } from "@/lib/ai/testing/fake-db";

beforeEach(() => {
  resetState();
  invalidateAiConfig();
});

describe("runtime regression suite (synthetic data only)", () => {
  it("passes in full — every safety / privacy / security / reliability / analysis check", () => {
    const r = runRuntimeSuite("all");
    expect(r.failures).toEqual([]);
    expect(r.passed).toBe(RUNTIME_CHECK_COUNT);
    expect(r.passed).toBeGreaterThanOrEqual(40);
  });
  it("can be run one suite at a time", () => {
    for (const suite of ["safety", "privacy", "security", "reliability", "analysis"]) {
      const r = runRuntimeSuite(suite);
      expect(r.passed, suite).toBeGreaterThan(0);
      expect(r.failed, suite).toBe(0);
    }
  });
});

describe("rollout phases", () => {
  it("advance one step at a time and any phase can return to DISABLED", () => {
    expect(validTransition("DISABLED", "INTERNAL_TEST")).toBe(true);
    expect(validTransition("DISABLED", "PRODUCTION")).toBe(false);
    expect(validTransition("INTERNAL_TEST", "PRODUCTION")).toBe(false);
    expect(validTransition("STAFF_PILOT", "LIMITED_PRODUCTION")).toBe(true);
    for (const p of ["INTERNAL_TEST", "STAFF_PILOT", "LIMITED_PRODUCTION", "PRODUCTION"] as const) expect(validTransition(p, "DISABLED")).toBe(true);
    expect(validTransition("PRODUCTION", "PRODUCTION")).toBe(false);
  });

  it("moving to INTERNAL_TEST needs no test run, but going beyond it needs a fresh passing one", async () => {
    setConfig({ phase: "DISABLED" });
    invalidateAiConfig();
    const a = admin("SUPER_ADMIN");
    await setRolloutPhase(a, "INTERNAL_TEST", "start internal testing");
    invalidateAiConfig();
    await expect(setRolloutPhase(a, "STAFF_PILOT", "pilot")).rejects.toMatchObject({ status: 409 });
    await runTests(a);
    invalidateAiConfig();
    await expect(setRolloutPhase(a, "STAFF_PILOT", "pilot")).resolves.toMatchObject({ from: "INTERNAL_TEST", to: "STAFF_PILOT" });
    expect(state.audits.filter((x) => x.action === "AI_ROLLOUT_CHANGED").length).toBe(2);
    expect(state.history.filter((h) => h.kind === "ROLLOUT").length).toBe(2);
  });

  it("rejects skipping phases", async () => {
    setConfig({ phase: "DISABLED" });
    invalidateAiConfig();
    await expect(setRolloutPhase(admin("SUPER_ADMIN"), "PRODUCTION", "skip")).rejects.toMatchObject({ status: 400 });
  });
});

describe("kill switch", () => {
  it("turns AI off, keeps the phase, audits with the reason, and is reversible", async () => {
    setConfig({ phase: "PRODUCTION" });
    invalidateAiConfig();
    const a = admin("SUPER_ADMIN");
    await setKillSwitch(a, true, "suspected unsafe output");
    expect(state.config).toMatchObject({ killSwitchActive: true, phase: "PRODUCTION", killSwitchReason: "suspected unsafe output" });
    expect(state.audits.some((x) => x.action === "AI_KILL_SWITCH_USED" && x.meta?.active === true && x.meta?.reason === "suspected unsafe output")).toBe(true);
    invalidateAiConfig();
    await setKillSwitch(a, false, "cause fixed");
    expect(state.config).toMatchObject({ killSwitchActive: false, killSwitchReason: null });
    expect(state.history.filter((h) => h.kind === "KILL_SWITCH").length).toBe(2);
  });
});

describe("configuration changes are validated, gated and audited", () => {
  it("rejects unknown keys — including anything that looks like a secret — and bad ranges", () => {
    for (const bad of [{ apiKey: "sk-1" }, { ANTHROPIC_API_KEY: "sk-1" }, { secret: "x" }, { temperature: 5 }, { timeoutMs: 10 }, { retryCount: 10 }, { model: "bad model!" }, { storageModes: { NOT_A_FEATURE: "FULL_RESULT" } }, { retentionDays: 0 }]) {
      expect(configPatchSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(configPatchSchema.safeParse({ temperature: 0.3, retentionDays: 14, storageModes: { PROFILE_SUMMARY: "DO_NOT_STORE" } }).success).toBe(true);
  });

  it("a provider/model/storage change needs a fresh passing test run", async () => {
    const a = admin("SUPER_ADMIN");
    await expect(updateConfig(a, { provider: "ANTHROPIC" }, "enable external")).rejects.toMatchObject({ status: 409 });
    await expect(updateConfig(a, { model: "another-model" }, "new model")).rejects.toMatchObject({ status: 409 });
    await expect(updateConfig(a, { storageModes: { PROFILE_SUMMARY: "FULL_RESULT" } }, "store more")).rejects.toMatchObject({ status: 409 });
    expect(state.config).toMatchObject({ provider: "RULES" }); // nothing changed
    await runTests(a);
    invalidateAiConfig();
    await updateConfig(a, { provider: "ANTHROPIC", externalProviderAllowed: true, model: "some-model" }, "approved after tests");
    expect(state.config).toMatchObject({ provider: "ANTHROPIC", externalProviderAllowed: true, model: "some-model" });
    expect(state.history.at(-1)).toMatchObject({ kind: "MODEL", reason: "approved after tests" });
    expect(state.audits.some((x) => x.action === "AI_CONFIGURATION_CHANGED" && x.meta?.kind === "MODEL")).toBe(true);
  });

  it("harmless settings (limits) can change without a test run, and are still audited", async () => {
    await updateConfig(admin("SUPER_ADMIN"), { dailyRequestCap: 100 }, "lower the cap");
    expect(state.config).toMatchObject({ dailyRequestCap: 100 });
    expect(state.audits.some((x) => x.action === "AI_CONFIGURATION_CHANGED")).toBe(true);
  });

  it("a passing test run stops counting once the prompts change or it gets old", async () => {
    const a = admin("SUPER_ADMIN");
    await runTests(a);
    expect(await latestPassingRun()).not.toBeNull();
    // tamper: pretend the run was made against different prompt checksums
    (state.testRuns.at(-1) as { promptVersions: Record<string, string> }).promptVersions = { ...allPromptChecksums(), "LPP-AI-COPILOT-v1.0": "old-checksum" };
    expect(await latestPassingRun()).toBeNull();
    (state.testRuns.at(-1) as { promptVersions: Record<string, string>; createdAt: Date }).promptVersions = allPromptChecksums();
    (state.testRuns.at(-1) as { createdAt: Date }).createdAt = new Date(Date.now() - 20 * 86_400_000);
    expect(await latestPassingRun()).toBeNull();
  });

  it("never records secrets or free text in the history", async () => {
    await updateConfig(admin("SUPER_ADMIN"), { dailyRequestCap: 50, priceInputPerMTokUsd: 3 }, "cost control");
    const h = JSON.stringify(state.history);
    expect(h).not.toMatch(/sk-|secret|password/i);
  });
});

describe("health classification", () => {
  it("is DISABLED when off, and never invents a rate without traffic", () => {
    expect(classifyHealth({ phase: "DISABLED", killSwitchActive: false, provider: "RULES" }, { requests: 0, failures: 0 })).toBe("DISABLED");
    expect(classifyHealth({ phase: "PRODUCTION", killSwitchActive: true, provider: "RULES" }, { requests: 100, failures: 0 })).toBe("DISABLED");
    expect(classifyHealth({ phase: "PRODUCTION", killSwitchActive: false, provider: "RULES" }, { requests: 0, failures: 0 })).toBe("OK");
    expect(classifyHealth({ phase: "PRODUCTION", killSwitchActive: false, provider: "RULES" }, { requests: 2, failures: 2 })).toBe("OK"); // too few requests to judge
  });
  it("flags DEGRADED and DOWN from real failure rates", () => {
    const c = { phase: "PRODUCTION" as const, killSwitchActive: false, provider: "ANTHROPIC" as const };
    expect(classifyHealth(c, { requests: 10, failures: 4 })).toBe("DEGRADED");
    expect(classifyHealth(c, { requests: 10, failures: 9 })).toBe("DOWN");
  });
});

describe("AI alert rules and incident mapping", () => {
  const base: MetricsSnapshot = {
    dbOk: true, dbLatencyMs: 5, serverErrorsLastHour: 0, storageErrorsLastHour: 0, permissionViolationsLastHour: 0, failedAdminLoginsLastHour: 0, failedPaymentsLast24h: 0, failedWebhooksLast24h: 0,
    reconciliationMismatches: 0, queueBacklog: 0, deadLetterJobs: 0, cronConsecutiveFailures: 0, backupsEnabled: false, lastSuccessfulBackupAgeHours: null, lastBackupFailed: false, lastRestoreTestStatus: null,
    lastRestoreTestAgeDays: null, dbSizeMb: null, fileStorageMb: null, configCritical: false,
  };
  const t = { apiLatencyWarnMs: 2000, errorRateWarnPerHour: 10, failedLoginSpikeThreshold: 10, paymentFailureSpikeThreshold: 5, webhookFailureSpikeThreshold: 5, queueBacklogThreshold: 20, permissionViolationThreshold: 20, dbStorageLimitMb: null, fileStorageLimitMb: null, capacityWarnPercent: 80, backupStaleAfterHours: 36, restoreTestStaleAfterDays: 35 } as AlertThresholds;
  const ai = { requestsLastHour: 0, failuresLastHour: 0, safetyBlocksLast24h: 0, deniedAccessLast24h: 0, estimatedCostLast24hUsd: 0, estimatedCostDailyAvg7dUsd: 0 };
  const cats = (m: MetricsSnapshot) => evaluateAlertRules(m, t).map((a) => a.category);

  it("raises nothing when AI metrics are absent or quiet", () => {
    expect(cats(base)).toEqual([]);
    expect(cats({ ...base, ai })).toEqual([]);
  });
  it("raises the four AI alert categories", () => {
    expect(cats({ ...base, ai: { ...ai, requestsLastHour: 10, failuresLastHour: 6 } })).toContain("AI_FAILURE_RATE");
    expect(cats({ ...base, ai: { ...ai, safetyBlocksLast24h: 6 } })).toContain("AI_UNSAFE_OUTPUT");
    expect(cats({ ...base, ai: { ...ai, deniedAccessLast24h: 12 } })).toContain("AI_UNAUTHORIZED_ACCESS");
    expect(cats({ ...base, ai: { ...ai, estimatedCostLast24hUsd: 9, estimatedCostDailyAvg7dUsd: 1 } })).toContain("AI_COST_SPIKE");
  });
  it("does not raise a cost alert on a tiny absolute amount or with no baseline", () => {
    expect(cats({ ...base, ai: { ...ai, estimatedCostLast24hUsd: 0.5, estimatedCostDailyAvg7dUsd: 0.01 } })).not.toContain("AI_COST_SPIKE");
    expect(cats({ ...base, ai: { ...ai, estimatedCostLast24hUsd: 20, estimatedCostDailyAvg7dUsd: 0 } })).not.toContain("AI_COST_SPIKE");
  });
  it("maps AI alerts onto existing incident categories", () => {
    expect(incidentCategoryFor("AI_UNAUTHORIZED_ACCESS")).toBe("SECURITY_BREACH");
    expect(incidentCategoryFor("AI_UNSAFE_OUTPUT")).toBe("DATA_INTEGRITY_INCIDENT");
    expect(incidentCategoryFor("AI_FAILURE_RATE")).toBe("APPLICATION_OUTAGE");
  });
});

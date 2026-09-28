import { describe, it, expect, vi, beforeEach } from "vitest";

const ruleRows: Array<Record<string, unknown>> = [];
const createdRules: Array<Record<string, unknown>> = [];
const audits: Array<Record<string, unknown>> = [];
let failFind = false;

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Record<string, unknown>) => { audits.push(a); }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    riskRule: {
      findMany: vi.fn(async () => {
        if (failFind) throw new Error("db down");
        return ruleRows;
      }),
      findFirst: vi.fn(async () => (ruleRows.length ? ruleRows[0] : null)),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdRules.push(data);
        return data;
      }),
      aggregate: vi.fn(async () => ({ _max: { version: 3 } })),
    },
    riskFactor: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null), updateMany: vi.fn(), create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

const config = await import("./config");

beforeEach(() => {
  ruleRows.length = 0;
  createdRules.length = 0;
  audits.length = 0;
  failFind = false;
  config.clearRiskConfigCache();
});

describe("defaults reproduce the previous hard-coded thresholds", () => {
  it("uses built-in defaults (version 0) when no rule row exists", async () => {
    expect((await config.getEffectiveRule("excessive_proposals")).config).toMatchObject({ threshold: 20, windowHours: 24 });
    expect((await config.getEffectiveRule("contact_reuse")).config.threshold).toBe(2);
    expect((await config.getEffectiveRule("payment_anomaly")).version).toBe(0);
  });

  it("falls back to defaults if the database read fails (config never breaks detection)", async () => {
    failFind = true;
    expect((await config.getEffectiveRule("login_abuse")).config.threshold).toBe(8);
  });

  it("device and network rules are OFF by default", async () => {
    expect((await config.getEffectiveRule("shared_device")).config.enabled).toBe(false);
    expect((await config.getEffectiveRule("unusual_network")).config.enabled).toBe(false);
  });

  it("an active rule row overrides only the fields it sets and ignores wrong-typed fields", async () => {
    ruleRows.push({ ruleKey: "login_abuse", version: 2, jurisdictionScope: "GLOBAL", configuration: JSON.stringify({ threshold: 12, windowMinutes: "oops", evil: 1 }) });
    const rule = await config.getEffectiveRule("login_abuse");
    expect(rule.version).toBe(2);
    expect(rule.config).toEqual({ threshold: 12, windowMinutes: 15 });
  });
});

describe("validateRuleConfig (rule tampering)", () => {
  it("rejects unknown rule keys and unknown fields", () => {
    expect(() => config.validateRuleConfig("nope", {})).toThrow(/Unknown risk rule/);
    expect(() => config.validateRuleConfig("login_abuse", { bypass: 1 })).toThrow(/Unknown field/);
  });
  it("rejects wrong types, negatives, fractions and absurd values", () => {
    expect(() => config.validateRuleConfig("login_abuse", { threshold: "5" })).toThrow(/must be a number/);
    expect(() => config.validateRuleConfig("login_abuse", { threshold: -1 })).toThrow(/whole number/);
    expect(() => config.validateRuleConfig("login_abuse", { threshold: 2.5 })).toThrow(/whole number/);
    expect(() => config.validateRuleConfig("login_abuse", { threshold: 10_000 })).toThrow(/whole number/);
  });
  it("keeps score bands strictly ordered", () => {
    expect(() => config.validateRuleConfig("score_bands", { medium: 50, high: 40, critical: 70 })).toThrow(/Score bands/);
    expect(config.validateRuleConfig("score_bands", { medium: 25, high: 50, critical: 80 })).toEqual({ medium: 25, high: 50, critical: 80 });
  });
});

describe("sensitive-trait guard", () => {
  it.each(["religion", "sect", "ethnicity", "caste", "race", "familyBackground", "monthlyIncome", "attractiveness", "politicalView", "healthStatus", "photoSimilarity"])(
    "flags %s as a forbidden scoring/duplicate field",
    (field) => {
      expect(config.isForbiddenTraitField(field)).toBe(true);
    }
  );
  it.each(["mobile", "email", "loginFailures", "proposalCount", "verifiedPhone", "ipHash"])("allows %s", (field) => {
    expect(config.isForbiddenTraitField(field)).toBe(false);
  });
  it("assertNoSensitiveTraits throws 422 naming the fields", () => {
    expect(() => config.assertNoSensitiveTraits(["religion", "email"], "A factor")).toThrow(/religion/);
  });
  it("no built-in factor or rule uses a sensitive trait", () => {
    for (const key of Object.keys(config.FACTOR_DEFINITIONS)) expect(config.isForbiddenTraitField(key)).toBe(false);
    for (const key of Object.keys(config.RULE_DEFINITIONS)) expect(config.isForbiddenTraitField(key)).toBe(false);
  });
});

describe("setRule creates a NEW version, never edits in place", () => {
  it("creates version+1, supersedes the old row, audits with the reason", async () => {
    ruleRows.push({ ruleKey: "login_abuse", version: 4, jurisdictionScope: "GLOBAL", configuration: "{}" });
    await config.setRule({ ruleKey: "login_abuse", config: { threshold: 6 }, actorId: "a1", reason: "tighten" });
    expect(createdRules[0]).toMatchObject({ ruleKey: "login_abuse", version: 5, status: "ACTIVE", createdById: "a1" });
    expect(JSON.parse(createdRules[0].configuration as string).threshold).toBe(6);
    expect(audits[0]).toMatchObject({ action: "RISK_RULE_CHANGED", meta: { ruleKey: "login_abuse", version: 5, previousVersion: 4, reason: "tighten" } });
  });
  it("rejects invalid config before writing anything", async () => {
    await expect(config.setRule({ ruleKey: "login_abuse", config: { threshold: -5 }, actorId: "a1", reason: "x" })).rejects.toThrow();
    expect(createdRules).toHaveLength(0);
  });
  it("factor weights are bounded and immediateControl cannot be edited", async () => {
    await expect(config.setFactor({ factorKey: "LOGIN_ABUSE_SIGNAL", weight: 999, enabled: true, actorId: "a1", reason: "x" })).rejects.toThrow(/weight/);
    await expect(config.setFactor({ factorKey: "UNKNOWN", weight: 5, enabled: true, actorId: "a1", reason: "x" })).rejects.toThrow(/Unknown risk factor/);
    const created = (await config.setFactor({ factorKey: "PROFILE_CHURN_SIGNAL", weight: 12, enabled: true, actorId: "a1", reason: "x" })) as unknown as Record<string, unknown>;
    expect(created.immediateControl).toBe(false);
  });
});

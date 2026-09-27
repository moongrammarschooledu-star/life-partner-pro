import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeRule { id: string; ruleCode: string; jurisdictionId: string; requirementType: string; subject: string; status: string; effectiveFrom: Date; effectiveTo: Date | null; ruleVersion: number; configuration: string; }

let rules: FakeRule[];
let platformPolicy: { retentionDays: number; action: string; isActive: boolean } | null;

vi.mock("@/lib/privacy/retention-policy", () => ({ getRetentionPolicy: vi.fn(async () => platformPolicy) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    complianceRule: {
      findMany: vi.fn(async ({ where }: { where: { jurisdictionId: string; requirementType?: string; subject?: string; status: string } }) => {
        return rules
          .filter(
            (r) =>
              r.jurisdictionId === where.jurisdictionId &&
              r.status === where.status &&
              (!where.requirementType || r.requirementType === where.requirementType) &&
              (!where.subject || r.subject === where.subject)
          )
          .sort((a, b) => b.ruleVersion - a.ruleVersion);
      }),
    },
  },
}));

const { evaluateRequirement, getApplicableRules, requiresAgeRestriction, getRetentionPolicy, isCrossBorderTransferAllowed, isFamilyAccessRestricted } = await import("./rule-engine");

beforeEach(() => {
  rules = [];
  platformPolicy = null;
});

describe("evaluateRequirement", () => {
  it("returns unresolved + reviewRequired when no active rule matches", async () => {
    const result = await evaluateRequirement("j1", "AGE_MINIMUM");
    expect(result).toEqual({ resolved: false, value: null, reviewRequired: true, matchedRules: [] });
  });

  it("resolves from an ACTIVE rule's configuration", async () => {
    rules.push({ id: "r1", ruleCode: "LPP-CRULE-000001", jurisdictionId: "j1", requirementType: "AGE_MINIMUM", subject: "*", status: "ACTIVE", effectiveFrom: new Date("2020-01-01"), effectiveTo: null, ruleVersion: 1, configuration: JSON.stringify({ minAge: 18 }) });
    const result = await evaluateRequirement<{ minAge: number }>("j1", "AGE_MINIMUM");
    expect(result.resolved).toBe(true);
    expect(result.value).toEqual({ minAge: 18 });
    expect(result.reviewRequired).toBe(false);
  });

  it("never resolves from a DRAFT or SUSPENDED rule — only ACTIVE counts", async () => {
    rules.push({ id: "r1", ruleCode: "LPP-CRULE-000001", jurisdictionId: "j1", requirementType: "AGE_MINIMUM", subject: "*", status: "DRAFT", effectiveFrom: new Date("2020-01-01"), effectiveTo: null, ruleVersion: 1, configuration: JSON.stringify({ minAge: 18 }) });
    const result = await requiresAgeRestriction("j1");
    expect(result.resolved).toBe(false);
    expect(result.reviewRequired).toBe(true);
  });

  it("prefers the highest ruleVersion when multiple ACTIVE rules exist for the same requirement", async () => {
    rules.push(
      { id: "r1", ruleCode: "LPP-CRULE-000001", jurisdictionId: "j1", requirementType: "AGE_MINIMUM", subject: "*", status: "ACTIVE", effectiveFrom: new Date("2020-01-01"), effectiveTo: null, ruleVersion: 1, configuration: JSON.stringify({ minAge: 16 }) },
      { id: "r2", ruleCode: "LPP-CRULE-000002", jurisdictionId: "j1", requirementType: "AGE_MINIMUM", subject: "*", status: "ACTIVE", effectiveFrom: new Date("2021-01-01"), effectiveTo: null, ruleVersion: 2, configuration: JSON.stringify({ minAge: 18 }) }
    );
    const result = await requiresAgeRestriction("j1");
    expect(result.value).toEqual({ minAge: 18 });
  });

  it("treats malformed rule configuration JSON as unresolved rather than throwing", async () => {
    rules.push({ id: "r1", ruleCode: "LPP-CRULE-000001", jurisdictionId: "j1", requirementType: "AGE_MINIMUM", subject: "*", status: "ACTIVE", effectiveFrom: new Date("2020-01-01"), effectiveTo: null, ruleVersion: 1, configuration: "{not json" });
    const result = await requiresAgeRestriction("j1");
    expect(result.resolved).toBe(false);
    expect(result.reviewRequired).toBe(true);
  });
});

describe("getApplicableRules", () => {
  it("lists all active rules for a jurisdiction", async () => {
    rules.push({ id: "r1", ruleCode: "LPP-CRULE-000001", jurisdictionId: "j1", requirementType: "AGE_MINIMUM", subject: "*", status: "ACTIVE", effectiveFrom: new Date("2020-01-01"), effectiveTo: null, ruleVersion: 1, configuration: "{}" });
    const result = await getApplicableRules("j1");
    expect(result).toHaveLength(1);
  });
});

describe("getRetentionPolicy — the one place this engine defers to STEP 13", () => {
  it("uses a jurisdiction-specific rule when one is ACTIVE", async () => {
    rules.push({ id: "r1", ruleCode: "LPP-CRULE-000001", jurisdictionId: "j1", requirementType: "RETENTION_PERIOD", subject: "VERIFICATION_DOCUMENTS", status: "ACTIVE", effectiveFrom: new Date("2020-01-01"), effectiveTo: null, ruleVersion: 1, configuration: JSON.stringify({ retentionDays: 30, action: "DELETE" }) });
    const result = await getRetentionPolicy("j1", "VERIFICATION_DOCUMENTS");
    expect(result.resolved).toBe(true);
    expect(result.value).toEqual({ retentionDays: 30, action: "DELETE" });
  });

  it("falls back to the existing platform-wide RetentionPolicy when no jurisdiction rule overrides it", async () => {
    platformPolicy = { retentionDays: 365, action: "ANONYMIZE", isActive: true };
    const result = await getRetentionPolicy("j1", "VERIFICATION_DOCUMENTS");
    expect(result.resolved).toBe(true);
    expect(result.value).toEqual({ retentionDays: 365, action: "ANONYMIZE" });
  });

  it("is unresolved when neither a rule nor a platform policy exists", async () => {
    const result = await getRetentionPolicy("j1", "VERIFICATION_DOCUMENTS");
    expect(result.resolved).toBe(false);
    expect(result.reviewRequired).toBe(true);
  });
});

describe("isCrossBorderTransferAllowed", () => {
  it("is unresolved (never defaults to allowed) with no matching rule", async () => {
    const result = await isCrossBorderTransferAllowed("j1", "US");
    expect(result.resolved).toBe(false);
    expect(result.reviewRequired).toBe(true);
  });
});

describe("isFamilyAccessRestricted", () => {
  it("is unresolved (never restricted) with no matching rule — family access stays available by default", async () => {
    const result = await isFamilyAccessRestricted("j1");
    expect(result.resolved).toBe(false);
  });

  it("resolves true only from an explicit ACTIVE rule", async () => {
    rules.push({ id: "r1", ruleCode: "LPP-CRULE-000001", jurisdictionId: "j1", requirementType: "FAMILY_ACCESS_RESTRICTED", subject: "*", status: "ACTIVE", effectiveFrom: new Date("2020-01-01"), effectiveTo: null, ruleVersion: 1, configuration: JSON.stringify({ restricted: true }) });
    const result = await isFamilyAccessRestricted("j1");
    expect(result.resolved).toBe(true);
    expect(result.value).toEqual({ restricted: true });
  });
});

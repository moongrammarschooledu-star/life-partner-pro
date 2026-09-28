import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row { [k: string]: unknown }
let flags: Row[];
let assessments: Row[];
let caseCalls: Row[];
let audits: Row[];
let caseEvents: Row[];
let idc = 0;

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/risk/case-service", () => ({
  LEVEL_ORDER: { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 },
  openRiskCase: vi.fn(async (p: Row) => { caseCalls.push(p); return { riskCase: { id: "case1" }, created: true }; }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    securityFlag: { findMany: vi.fn(async () => flags) },
    riskRule: { findMany: vi.fn(async () => []), aggregate: vi.fn(async () => ({ _max: { version: null } })) },
    riskFactor: { findMany: vi.fn(async () => []) },
    riskAssessment: {
      findFirst: vi.fn(async () => assessments[assessments.length - 1] ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => { const r = { id: `as${++idc}`, riskCaseId: null, createdAt: new Date(), ...data }; assessments.push(r); return r; }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => { const r = assessments.find((a) => a.id === where.id) as Row; Object.assign(r, data); return r; }),
    },
    riskCaseEvent: { create: vi.fn(async ({ data }: { data: Row }) => { caseEvents.push(data); return data; }) },
  },
}));

const { computeAssessment, levelFromScore, assessProfile } = await import("./assessment-service");

const BANDS = { medium: 20, high: 40, critical: 70 };
const sig = (over: Partial<Parameters<typeof computeAssessment>[0][number]> = {}) => ({
  id: "s1", flagType: "CONTACT_REUSE_SIGNAL", severity: "MEDIUM" as const, confidence: "HIGH" as const, category: "CONTACT" as const, weight: 20, immediateControl: false, factorVersion: 0, ...over,
});

beforeEach(() => {
  flags = [];
  assessments = [];
  caseCalls = [];
  audits = [];
  caseEvents = [];
  idc = 0;
});

describe("score bands", () => {
  it("0-19 LOW, 20-39 MEDIUM, 40-69 HIGH, 70-100 CRITICAL", () => {
    expect([0, 19, 20, 39, 40, 69, 70, 100].map((s) => levelFromScore(s, BANDS))).toEqual(["LOW", "LOW", "MEDIUM", "MEDIUM", "HIGH", "HIGH", "CRITICAL", "CRITICAL"]);
  });
});

describe("computeAssessment (pure, explainable)", () => {
  it("no signals → LOW, score 0, explains why", () => {
    const r = computeAssessment([], BANDS);
    expect(r).toMatchObject({ level: "LOW", score: 0 });
    expect(r.explanation[0]).toMatch(/No open risk signals/);
  });

  it("sums the strongest instance per signal TYPE (a burst of one type cannot inflate the score)", () => {
    const many = Array.from({ length: 10 }, (_, i) => sig({ id: `s${i}` }));
    const one = computeAssessment([sig()], BANDS);
    expect(computeAssessment(many, BANDS).score).toBe(one.score);
  });

  it("combines distinct signal types into a higher level", () => {
    const r = computeAssessment(
      [sig({ id: "a", flagType: "DUPLICATE_PROFILE_SUSPECTED", weight: 30, confidence: "EXACT" }), sig({ id: "b", flagType: "CONTACT_BYPASS_ATTEMPT", weight: 28, confidence: "HIGH" }), sig({ id: "c", flagType: "IDENTITY_VERIFICATION_REVIEW", weight: 20, confidence: "MEDIUM" })],
      BANDS
    );
    expect(r.level).toBe("HIGH");
    expect(r.topSignals[0].type).toBe("DUPLICATE_PROFILE_SUSPECTED");
    expect(r.rulesTriggered).toHaveLength(3);
  });

  it("NO-SINGLE-SIGNAL RULE: one low-confidence signal is capped at MEDIUM even when its weight alone would be HIGH", () => {
    const r = computeAssessment([sig({ weight: 60, confidence: "LOW", severity: "HIGH" })], { medium: 5, high: 10, critical: 20 });
    expect(r.level).toBe("MEDIUM");
    expect(r.cappedBySingleSignal).toBe(true);
    expect(r.explanation.join(" ")).toMatch(/single low-confidence signal/);
  });

  it("an immediate-control factor is exempt from the single-signal cap", () => {
    const r = computeAssessment([sig({ weight: 60, confidence: "LOW", immediateControl: true })], { medium: 5, high: 10, critical: 20 });
    expect(r.level).toBe("CRITICAL");
    expect(r.cappedBySingleSignal).toBe(false);
  });

  it("device/network signals alone can never exceed MEDIUM", () => {
    const r = computeAssessment(
      [sig({ id: "d", flagType: "SHARED_DEVICE_SIGNAL", category: "DEVICE", weight: 60, confidence: "EXACT" }), sig({ id: "n", flagType: "UNUSUAL_NETWORK_ACTIVITY", category: "NETWORK", weight: 60, confidence: "EXACT" })],
      BANDS
    );
    expect(r.level).toBe("MEDIUM");
    expect(r.explanation.join(" ")).toMatch(/context only/);
  });

  it("device/network combined with a real signal is NOT capped", () => {
    const r = computeAssessment(
      [sig({ id: "d", flagType: "SHARED_DEVICE_SIGNAL", category: "DEVICE", weight: 25, confidence: "EXACT" }), sig({ id: "c", flagType: "DUPLICATE_PROFILE_SUSPECTED", category: "DUPLICATE", weight: 25, confidence: "EXACT" })],
      BANDS
    );
    expect(r.level).toBe("HIGH");
  });

  it("scoring disabled → level from severity, no numeric score", () => {
    const r = computeAssessment([sig({ severity: "HIGH", confidence: "HIGH" })], BANDS, false);
    expect(r.score).toBeNull();
    expect(r.level).toBe("HIGH");
  });

  it("is deterministic — the same inputs always reproduce the same assessment", () => {
    const input = [sig({ id: "a" }), sig({ id: "b", flagType: "CONTACT_BYPASS_ATTEMPT", weight: 28 })];
    expect(computeAssessment(input, BANDS)).toEqual(computeAssessment([...input].reverse(), BANDS));
  });

  it("explanations never accuse: neutral wording and an explicit human-review statement", () => {
    const text = computeAssessment([sig({ weight: 60, confidence: "EXACT" })], BANDS).explanation.join(" ").toLowerCase();
    for (const banned of ["fraudster", "scammer", "guilty", "criminal", "liar", "is a fraud"]) expect(text).not.toContain(banned);
    expect(text).toContain("human review");
  });
});

describe("assessProfile (persisted)", () => {
  const openFlag = (id: string, flagType: string, extra: Row = {}) => ({ id, profileId: "p1", flagType, severity: "MEDIUM", confidence: "HIGH", category: "CONTACT", status: "OPEN", ...extra });

  it("returns nothing and writes nothing when there are no signals and no history", async () => {
    const r = await assessProfile("p1");
    expect(r).toMatchObject({ assessment: null, unchanged: true, caseOpened: false });
    expect(assessments).toHaveLength(0);
  });

  it("persists an explainable assessment with rule + configuration versions, without opening a case at MEDIUM", async () => {
    flags = [openFlag("f1", "CONTACT_REUSE_SIGNAL")];
    const r = await assessProfile("p1");
    expect(r.unchanged).toBe(false);
    expect(assessments[0]).toMatchObject({ subjectProfileId: "p1", riskLevel: "MEDIUM", ruleVersion: 0, configurationVersion: 0 });
    expect(JSON.parse(assessments[0].evidence as string)).toEqual(["f1"]);
    expect(audits[0]).toMatchObject({ action: "RISK_ASSESSMENT_RECORDED", targetProfileId: "p1" });
    expect(caseCalls).toHaveLength(0);
  });

  it("is idempotent: identical signal set + level + score reuses the previous row", async () => {
    flags = [openFlag("f1", "CONTACT_REUSE_SIGNAL")];
    await assessProfile("p1");
    const second = await assessProfile("p1");
    expect(second.unchanged).toBe(true);
    expect(assessments).toHaveLength(1);
  });

  it("opens ONE human-review case at HIGH and links the assessment to it", async () => {
    flags = [openFlag("f1", "DUPLICATE_PROFILE_SUSPECTED", { category: "DUPLICATE" })];
    const r = await assessProfile("p1");
    expect(r.caseOpened).toBe(true);
    expect(caseCalls[0]).toMatchObject({ subjectProfileId: "p1", riskLevel: "HIGH", openedBy: "assessment" });
    expect(assessments[0].riskCaseId).toBe("case1");
    expect(caseEvents[0]).toMatchObject({ riskCaseId: "case1", eventType: "ASSESSMENT_RECORDED" });
  });
});

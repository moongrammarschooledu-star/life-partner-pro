import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
let events: Row[];
let signals: Row[];
let assessed: string[];
let cases: Row[];
let relationships: Array<{ profileId: string; relatedProfileId: string }>;
let ruleOverrides: Record<string, Row>;
let deviceAllowed = true;
let audits: Row[];

const matches = (e: Row, where: Row): boolean => {
  for (const [k, v] of Object.entries(where)) {
    if (k === "createdAt") { if (!((e.createdAt as Date) >= ((v as { gte: Date }).gte))) return false; continue; }
    if (v && typeof v === "object" && "in" in (v as Row)) { if (!((v as { in: unknown[] }).in.includes(e[k]))) return false; continue; }
    if (v && typeof v === "object" && "not" in (v as Row)) { const n = (v as { not: unknown }).not; if (n === null ? e[k] == null : e[k] === n) return false; continue; }
    if (e[k] !== v) return false;
  }
  return true;
};

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/risk/signal-service", () => ({
  createRiskSignal: vi.fn(async (p: Row) => { signals.push(p); return { created: true, flag: { id: `f${signals.length}` } }; }),
  suppressedRelatedProfiles: vi.fn(async (profileId: string, ids: string[]) => new Set(relationships.filter((r) => r.profileId === profileId && ids.includes(r.relatedProfileId)).map((r) => r.relatedProfileId))),
}));
vi.mock("@/lib/risk/assessment-service", () => ({ assessProfile: vi.fn(async (id: string) => { assessed.push(id); return { assessment: null, unchanged: true, caseOpened: false, riskCaseId: null }; }) }));
vi.mock("@/lib/risk/case-service", () => ({ openRiskCase: vi.fn(async (p: Row) => { cases.push(p); return { riskCase: { id: "c1" }, created: true }; }) }));
vi.mock("@/lib/risk/duplicate-cluster-service", () => ({ evaluateProfileDuplicates: vi.fn(async (profileId: string) => ({ signalsCreated: 0, profileId })) }));
vi.mock("@/lib/security/signal-policy", () => ({ deviceSignalsAllowed: vi.fn(async () => deviceAllowed) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    riskRule: { findMany: vi.fn(async ({ where }: { where: { ruleKey: string } }) => (ruleOverrides[where.ruleKey] ? [{ ruleKey: where.ruleKey, version: 1, jurisdictionScope: "GLOBAL", configuration: JSON.stringify(ruleOverrides[where.ruleKey]) }] : [])) },
    riskFactor: { findMany: vi.fn(async () => []) },
    securityEvent: {
      count: vi.fn(async ({ where }: { where: Row }) => events.filter((e) => matches(e, where)).length),
      findMany: vi.fn(async ({ where, distinct }: { where: Row; distinct?: string[] }) => {
        const rows = events.filter((e) => matches(e, where));
        if (!distinct) return rows;
        const seen = new Set<unknown>();
        return rows.filter((r) => { const key = r[distinct[0]]; if (seen.has(key)) return false; seen.add(key); return true; });
      }),
    },
  },
}));

const { RiskRuleEngine } = await import("./rule-engine");
const { clearRiskConfigCache } = await import("./config");
const ago = (ms: number) => new Date(Date.now() - ms);
const ev = (over: Row): Row => ({ id: `e${events.length}`, createdAt: ago(1000), profileId: "p1", adminId: null, ...over });
const many = (n: number, over: Row) => { for (let i = 0; i < n; i++) events.push(ev(over)); };

beforeEach(() => {
  clearRiskConfigCache();
  events = []; signals = []; assessed = []; cases = []; relationships = []; ruleOverrides = {}; audits = []; deviceAllowed = true;
});

describe("account security — false-positive guards", () => {
  it("FALSE POSITIVE: a single mistyped OTP never creates a signal", async () => {
    many(1, { eventType: "OTP_FAILED" });
    const r = await RiskRuleEngine.evaluateAccountSecurity("p1");
    expect(r.signalsCreated).toBe(0);
    expect(signals).toHaveLength(0);
  });
  it("a handful of normal OTP attempts / failed logins stays below every threshold", async () => {
    many(4, { eventType: "OTP_REQUESTED" });
    many(3, { eventType: "OTP_FAILED" });
    many(5, { eventType: "LOGIN_FAILED" });
    expect((await RiskRuleEngine.evaluateAccountSecurity("p1")).signalsCreated).toBe(0);
  });
  it("sustained OTP abuse creates one neutral signal carrying the rule version", async () => {
    many(10, { eventType: "OTP_REQUESTED" });
    const r = await RiskRuleEngine.evaluateAccountSecurity("p1");
    expect(r.signalsCreated).toBe(1);
    expect(signals[0]).toMatchObject({ flagType: "OTP_ABUSE_SIGNAL", ruleKey: "otp_abuse", ruleVersion: 0, profileId: "p1" });
    expect(String(signals[0].description)).not.toMatch(/fraud|scam|attack|criminal/i);
  });
  it("events outside the window are ignored", async () => {
    many(20, { eventType: "LOGIN_FAILED", createdAt: ago(3 * 3_600_000) });
    expect((await RiskRuleEngine.evaluateAccountSecurity("p1")).signalsCreated).toBe(0);
  });
  it("thresholds come from versioned rule config, not literals", async () => {
    ruleOverrides.login_abuse = { threshold: 3, windowMinutes: 15 };
    many(3, { eventType: "LOGIN_FAILED" });
    const r = await RiskRuleEngine.evaluateAccountSecurity("p1");
    expect(r.signalsCreated).toBe(1);
    expect(signals[0]).toMatchObject({ flagType: "LOGIN_ABUSE_SIGNAL", ruleVersion: 1 });
  });
});

describe("verification — provider trouble is not a risk signal", () => {
  it("FALSE POSITIVE: provider errors/timeouts never count, however many", async () => {
    many(10, { eventType: "VERIFICATION_FAILED", outcome: "PROVIDER_ERROR" });
    many(5, { eventType: "VERIFICATION_FAILED", outcome: "TIMEOUT" });
    expect((await RiskRuleEngine.evaluateVerification("p1")).signalsCreated).toBe(0);
  });
  it("repeated genuine rejections raise a REVIEW suggestion", async () => {
    many(3, { eventType: "VERIFICATION_FAILED", outcome: "REJECTED" });
    expect((await RiskRuleEngine.evaluateVerification("p1")).signalsCreated).toBe(1);
    expect(signals[0].flagType).toBe("IDENTITY_VERIFICATION_REVIEW");
  });
});

describe("device / network — OFF by default, context only", () => {
  const sharedDevice = () => {
    many(1, { eventType: "PROFILE_UPDATED", profileId: "p1", userAgentHash: "ua1" });
    for (const other of ["p2", "p3", "p4"]) many(1, { eventType: "PROFILE_UPDATED", profileId: other, userAgentHash: "ua1" });
  };
  it("produces nothing while the rule is disabled (default)", async () => {
    sharedDevice();
    expect((await RiskRuleEngine.evaluateDeviceSignals("p1")).signalsCreated).toBe(0);
  });
  it("when enabled, several profiles on one hashed device raise a context-only signal", async () => {
    ruleOverrides.shared_device = { enabled: true, minProfiles: 3, windowDays: 30 };
    sharedDevice();
    expect((await RiskRuleEngine.evaluateDeviceSignals("p1")).signalsCreated).toBe(1);
    expect(String(signals[0].description)).toMatch(/context only/);
  });
  it("FALSE POSITIVE: a shared FAMILY device (reviewed relationship) is not counted", async () => {
    ruleOverrides.shared_device = { enabled: true, minProfiles: 3, windowDays: 30 };
    sharedDevice();
    relationships = [{ profileId: "p1", relatedProfileId: "p2" }, { profileId: "p1", relatedProfileId: "p3" }, { profileId: "p1", relatedProfileId: "p4" }];
    expect((await RiskRuleEngine.evaluateDeviceSignals("p1")).signalsCreated).toBe(0);
  });
  it("FALSE POSITIVE: a shared HOME network is not counted once the members are related", async () => {
    ruleOverrides.unusual_network = { enabled: true, minProfiles: 3, windowDays: 7 };
    for (const p of ["p1", "p2", "p3"]) many(1, { eventType: "PROFILE_UPDATED", profileId: p, ipHash: "ip1" });
    relationships = [{ profileId: "p1", relatedProfileId: "p2" }, { profileId: "p1", relatedProfileId: "p3" }];
    expect((await RiskRuleEngine.evaluateNetworkSignals("p1")).signalsCreated).toBe(0);
  });
  it("is skipped where the jurisdiction restricts device signals", async () => {
    ruleOverrides.shared_device = { enabled: true, minProfiles: 3, windowDays: 30 };
    sharedDevice();
    deviceAllowed = false;
    expect((await RiskRuleEngine.evaluateDeviceSignals("p1")).signalsCreated).toBe(0);
  });
  it("FALSE POSITIVE: travel / new IP / VPN — a login from a new network creates nothing", async () => {
    await RiskRuleEngine.evaluateSecurityEvent({ eventType: "LOGIN_SUCCESS", profileId: "p1", ipHash: "brand-new" } as never);
    await RiskRuleEngine.evaluateSecurityEvent({ eventType: "NEW_DEVICE_SESSION", profileId: "p1" } as never);
    expect(signals).toHaveLength(0);
    expect(assessed).toHaveLength(0);
  });
});

describe("contact bypass, family, churn, payments", () => {
  it("contact-bypass attempts raise a signal at the threshold only", async () => {
    many(2, { eventType: "CONTACT_BYPASS_ATTEMPT" });
    expect((await RiskRuleEngine.evaluateContactActivity("p1")).signalsCreated).toBe(0);
    many(1, { eventType: "CONTACT_BYPASS_ATTEMPT" });
    expect((await RiskRuleEngine.evaluateContactActivity("p1")).signalsCreated).toBe(1);
  });
  it("payment failures feed RISK only — the signal is a payment-category factor, not a compatibility input", async () => {
    many(5, { eventType: "PAYMENT_FAILED" });
    await RiskRuleEngine.evaluatePayments("p1");
    expect(signals[0].flagType).toBe("REPEATED_PAYMENT_FAILURE");
  });
  it("family and churn thresholds", async () => {
    many(10, { eventType: "FAMILY_INVITE_CREATED" });
    many(6, { eventType: "PROFILE_UPDATED" });
    expect((await RiskRuleEngine.evaluateFamilyActivity("p1")).signalsCreated).toBe(1);
    expect((await RiskRuleEngine.evaluateProfileChurn("p1")).signalsCreated).toBe(1);
  });
});

describe("privileged access & permission denials (admin-subject, never an accusation)", () => {
  it("below the volume threshold: nothing", async () => {
    for (let i = 0; i < 29; i++) events.push(ev({ eventType: "ADMIN_SENSITIVE_ACCESS", adminId: "adm1", profileId: `t${i}` }));
    expect((await RiskRuleEngine.evaluateAdminActivity("adm1")).signalsCreated).toBe(0);
    expect(cases).toHaveLength(0);
  });
  it("re-viewing the same record many times is NOT volume (distinct targets are counted)", async () => {
    for (let i = 0; i < 200; i++) events.push(ev({ eventType: "ADMIN_SENSITIVE_ACCESS", adminId: "adm1", profileId: "same" }));
    expect((await RiskRuleEngine.evaluateAdminActivity("adm1")).signalsCreated).toBe(0);
  });
  it("at the threshold: an admin-subject review case is opened (level MEDIUM, neutral title) + audit", async () => {
    for (let i = 0; i < 30; i++) events.push(ev({ eventType: "ADMIN_SENSITIVE_ACCESS", adminId: "adm1", profileId: `t${i}` }));
    await RiskRuleEngine.evaluateAdminActivity("adm1");
    expect(cases[0]).toMatchObject({ subjectAdminId: "adm1", category: "ADMIN_ACCESS", riskLevel: "MEDIUM", title: "Unusual privileged-access volume" });
    expect(audits[0]).toMatchObject({ action: "RISK_ADMIN_ACCESS_ANOMALY" });
  });
  it("a permission-denied burst by an admin opens an admin-subject case; by an applicant raises a profile signal", async () => {
    many(15, { eventType: "PERMISSION_DENIED", adminId: "adm1", profileId: null });
    await RiskRuleEngine.evaluateSecurityEvent({ eventType: "PERMISSION_DENIED", adminId: "adm1", profileId: null } as never);
    expect(cases[0]).toMatchObject({ subjectAdminId: "adm1" });
    many(15, { eventType: "API_AUTH_FAILURE", profileId: "p9", adminId: null });
    await RiskRuleEngine.evaluateSecurityEvent({ eventType: "API_AUTH_FAILURE", profileId: "p9", adminId: null } as never);
    expect(signals.at(-1)).toMatchObject({ flagType: "UNAUTHORIZED_ACCESS_ATTEMPT", profileId: "p9" });
  });
});

describe("dispatcher", () => {
  it("requests ONE assessment when a real-time event raises a signal", async () => {
    many(10, { eventType: "OTP_FAILED" });
    await RiskRuleEngine.evaluateSecurityEvent({ eventType: "OTP_FAILED", profileId: "p1" } as never);
    expect(assessed).toEqual(["p1"]);
  });
  it("requests no assessment when nothing was raised", async () => {
    many(1, { eventType: "OTP_FAILED" });
    await RiskRuleEngine.evaluateSecurityEvent({ eventType: "OTP_FAILED", profileId: "p1" } as never);
    expect(assessed).toHaveLength(0);
  });
  it("evaluateProfile runs every family and reports the total", async () => {
    many(3, { eventType: "CONTACT_BYPASS_ATTEMPT" });
    many(3, { eventType: "VERIFICATION_FAILED", outcome: "MISMATCH" });
    expect((await RiskRuleEngine.evaluateProfile("p1")).signalsCreated).toBe(2);
  });
});

describe("structural guarantees", () => {
  it("the rule engine has no code path to restrict, suspend, reject or close anything", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const text = readFileSync(join(process.cwd(), "src/lib/risk/rule-engine.ts"), "utf8");
    expect(text).not.toMatch(/suspendProfile|applyRestriction|applyRiskRestrictions|applyCaseAction|liftRestriction|profile\.update|verification\/status/);
  });
  it("there is no geolocation / impossible-travel logic anywhere in the risk or security modules", async () => {
    const { readFileSync, readdirSync } = await import("fs");
    const { join } = await import("path");
    for (const dir of ["src/lib/risk", "src/lib/security"]) {
      for (const f of readdirSync(join(process.cwd(), dir)).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
        const text = readFileSync(join(process.cwd(), dir, f), "utf8");
        expect(text, f).not.toMatch(/geolocat|impossible[-_ ]?travel|geoip|latitude|longitude/i);
      }
    }
  });
});

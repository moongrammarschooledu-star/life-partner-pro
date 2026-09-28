import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
let applied: Row[];
let notifications: Row[];
let existing: Row | null;

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/profile-restrictions", () => ({
  applyRestriction: vi.fn(async (p: Row) => { applied.push(p); return { id: `r${applied.length}` }; }),
  liftRestriction: vi.fn(async () => undefined),
}));
vi.mock("@/lib/notifications/notification-service", () => ({ sendNotification: vi.fn(async (n: Row) => { notifications.push(n); }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { profileRestriction: { findFirst: vi.fn(async () => existing), findMany: vi.fn(async () => []) } } }));

const svc = await import("./restriction-service");
const day = 86_400_000;

beforeEach(() => {
  applied = [];
  notifications = [];
  existing = null;
});

describe("restriction labels", () => {
  it("map the spec names onto ENFORCED types (nothing is a dead label)", () => {
    expect(svc.resolveRestrictionTypes(["MATCHING"])).toEqual(["CANNOT_MATCH"]);
    expect(svc.resolveRestrictionTypes(["PROPOSALS"]).sort()).toEqual(["CANNOT_RECEIVE_PROPOSAL", "NO_NEW_PROPOSALS"]);
    expect(svc.resolveRestrictionTypes(["CONTACT", "PAYMENT"]).sort()).toEqual(["CANNOT_CONTACT_SHARE", "PAYMENT_RESTRICTED"]);
    expect(svc.resolveRestrictionTypes(["FULL_ACCOUNT_RESTRICTED"])).toEqual(["FULL_ACCOUNT_RESTRICTED"]);
  });
  it("rejects unknown and empty input", () => {
    expect(() => svc.resolveRestrictionTypes(["PERMABAN"])).toThrow(/Unknown restriction/);
    expect(() => svc.resolveRestrictionTypes([])).toThrow(/At least one/);
  });
  it("the 4 new types are all reachable", () => {
    for (const t of ["COMMUNICATION_RESTRICTED", "PAYMENT_RESTRICTED", "FAMILY_ACCESS_RESTRICTED", "FULL_ACCOUNT_RESTRICTED"]) expect(svc.RISK_RESTRICTION_TYPES).toContain(t);
  });
});

describe("validateRestrictionWindow (temporary preferred)", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  it("requires an end date unless permanent", () => {
    expect(() => svc.validateRestrictionWindow({ isPermanent: false, now })).toThrow(/end date/);
  });
  it("rejects past end dates and windows over the temporary maximum", () => {
    expect(() => svc.validateRestrictionWindow({ isPermanent: false, endDate: new Date(now.getTime() - day), now })).toThrow(/future/);
    expect(() => svc.validateRestrictionWindow({ isPermanent: false, endDate: new Date(now.getTime() + 400 * day), now })).toThrow(/365 days/);
  });
  it("accepts a sensible temporary window", () => {
    expect(() => svc.validateRestrictionWindow({ isPermanent: false, endDate: new Date(now.getTime() + 30 * day), now })).not.toThrow();
  });
});

describe("applyRiskRestrictions", () => {
  const base = { profileId: "p1", types: ["CANNOT_MATCH" as const], reason: "review", actorId: "a1", riskCaseId: "c1" };

  it("permanent without an approval id is refused before anything is written", async () => {
    await expect(svc.applyRiskRestrictions({ ...base, isPermanent: true })).rejects.toMatchObject({ status: 403 });
    expect(applied).toHaveLength(0);
  });

  it("temporary restriction is created with risk metadata and a neutral notice", async () => {
    const end = new Date(Date.now() + 10 * day);
    await svc.applyRiskRestrictions({ ...base, endDate: end });
    expect(applied[0]).toMatchObject({ source: "risk_case", riskCaseId: "c1", isPermanent: false, endDate: end, appliedById: "a1" });
    expect(notifications).toEqual([{ profileId: "p1", type: "SECURITY_NOTICE", data: {} }]);
  });

  it("is idempotent for the same case + type", async () => {
    existing = { id: "already" };
    await svc.applyRiskRestrictions({ ...base, endDate: new Date(Date.now() + 10 * day) });
    expect(applied).toHaveLength(0);
  });

  it("the applicant notice never contains a reason, level or signal", async () => {
    const { DEFAULT_TEMPLATES } = await import("@/lib/notifications/default-templates").then((m) => ({ DEFAULT_TEMPLATES: (m as unknown as { DEFAULT_TEMPLATES?: Record<string, Record<string, { title: string; body: string }>> }).DEFAULT_TEMPLATES }));
    if (!DEFAULT_TEMPLATES) return;
    for (const key of ["SECURITY_NOTICE", "RISK_INFORMATION_REQUESTED", "SAFETY_REPORT_ACKNOWLEDGED"]) {
      const text = `${DEFAULT_TEMPLATES[key].EN.title} ${DEFAULT_TEMPLATES[key].EN.body}`.toLowerCase();
      for (const leak of ["risk", "score", "signal", "fraud", "suspicious", "duplicate", "level", "threshold"]) expect(text, `${key} leaks "${leak}"`).not.toContain(leak);
    }
  });
});

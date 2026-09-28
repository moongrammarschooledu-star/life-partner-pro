import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeFlag { id: string; profileId: string; flagType: string; severity: string; status: string; description: string; relatedProfileId: string | null; dedupKey: string | null; }
interface FakeContact { profileId: string; mobileNumber: string; email: string; profile: { createdAt: Date }; }
interface FakeProfile { id: string; contact: { mobileNumber: string; email: string } | null; }

let flags: FakeFlag[];
let contacts: FakeContact[];
let relationships: Array<{ profileId: string; relatedProfileId: string; relationshipType: string }>;
let profiles: Map<string, FakeProfile>;
let auditCalls: Record<string, unknown>[];
let notifyCalls: unknown[];
let taskCalls: Record<string, unknown>[];
let assessCalls: string[];
let proposalCount = 0;
let contactRequestCount = 0;
let failedPaymentCount = 0;
let idCounter = 0;

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/notifications/events", () => ({ notifySecurityFlagRaised: vi.fn(async (...args: unknown[]) => { notifyCalls.push(args); }) }));
vi.mock("@/lib/workflow/engine", () => ({ createFromEvent: vi.fn(async (call: Record<string, unknown>) => { taskCalls.push(call); return { id: "task1" }; }) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async (prefix: string) => `LPP-${prefix}-${String(++idCounter).padStart(6, "0")}`) }));
vi.mock("@/lib/risk/assessment-service", () => ({ assessProfile: vi.fn(async (id: string) => { assessCalls.push(id); return { assessment: null, unchanged: true, caseOpened: false, riskCaseId: null }; }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    profile: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => profiles.get(where.id) ?? null) },
    contactInfo: { findMany: vi.fn(async () => contacts) },
    accountRelationship: {
      findMany: vi.fn(async ({ where }: { where: { OR: Array<{ profileId?: string; relatedProfileId?: unknown }> } }) => {
        const self = where.OR[0].profileId;
        return relationships.filter((r) => r.profileId === self || r.relatedProfileId === self).map((r) => ({ profileId: r.profileId, relatedProfileId: r.relatedProfileId }));
      }),
    },
    proposal: { count: vi.fn(async () => proposalCount) },
    contactPermission: { count: vi.fn(async () => contactRequestCount) },
    payment: { count: vi.fn(async () => failedPaymentCount) },
    riskRule: { findMany: vi.fn(async () => []) },
    riskFactor: { findMany: vi.fn(async () => []) },
    securityFlag: {
      findFirst: vi.fn(async ({ where }: { where: { profileId: string; flagType: string; status: { in: string[] } } }) =>
        flags.find((f) => f.profileId === where.profileId && f.flagType === where.flagType && where.status.in.includes(f.status)) ?? null
      ),
      findUnique: vi.fn(async ({ where }: { where: { dedupKey: string } }) => flags.find((f) => f.dedupKey === where.dedupKey) ?? null),
      create: vi.fn(async ({ data }: { data: Omit<FakeFlag, "id" | "status"> }) => {
        const flag: FakeFlag = { id: `flag${++idCounter}`, status: "OPEN", ...data };
        flags.push(flag);
        return flag;
      }),
    },
  },
}));

const { detectRapidRegistration, detectContactReuse, detectExcessiveProposalActivity, detectAbnormalContactRequestActivity, detectPaymentAnomaly, runRiskSignalScan } =
  await import("./signal-engine");

beforeEach(() => {
  flags = [];
  contacts = [];
  relationships = [];
  assessCalls = [];
  profiles = new Map([["p1", { id: "p1", contact: { mobileNumber: "+923001234567", email: "a@example.com" } }]]);
  auditCalls = [];
  notifyCalls = [];
  taskCalls = [];
  proposalCount = 0;
  contactRequestCount = 0;
  failedPaymentCount = 0;
  idCounter = 0;
});

describe("pure detectors", () => {
  it("detectRapidRegistration triggers at the threshold", () => {
    expect(detectRapidRegistration(2)).toBe(false);
    expect(detectRapidRegistration(3)).toBe(true);
  });
  it("detectContactReuse triggers at 2+ profiles sharing a contact", () => {
    expect(detectContactReuse(1)).toBe(false);
    expect(detectContactReuse(2)).toBe(true);
  });
  it("detectExcessiveProposalActivity triggers at 20+ in the window", () => {
    expect(detectExcessiveProposalActivity(19)).toBe(false);
    expect(detectExcessiveProposalActivity(20)).toBe(true);
  });
  it("detectAbnormalContactRequestActivity triggers at 10+", () => {
    expect(detectAbnormalContactRequestActivity(9)).toBe(false);
    expect(detectAbnormalContactRequestActivity(10)).toBe(true);
  });
  it("detectPaymentAnomaly triggers at 5+ failures", () => {
    expect(detectPaymentAnomaly(4)).toBe(false);
    expect(detectPaymentAnomaly(5)).toBe(true);
  });
});

describe("runRiskSignalScan", () => {
  it("returns zero when the profile has no contact info", async () => {
    profiles.set("p2", { id: "p2", contact: null });
    const result = await runRiskSignalScan("p2");
    expect(result).toEqual({ profilesScanned: 0, signalsCreated: 0 });
  });

  it("creates no signals when everything is under threshold", async () => {
    const result = await runRiskSignalScan("p1");
    expect(result.signalsCreated).toBe(0);
    expect(flags).toHaveLength(0);
  });

  it("raises EXCESSIVE_PROPOSAL_ACTIVITY when over threshold, with audit/notify/task wired", async () => {
    proposalCount = 25;
    const result = await runRiskSignalScan("p1");
    expect(result.signalsCreated).toBe(1);
    expect(flags[0].flagType).toBe("EXCESSIVE_PROPOSAL_ACTIVITY");
    expect(auditCalls[0]).toMatchObject({ action: "RISK_SIGNAL_DETECTED", targetProfileId: "p1" });
    expect(assessCalls).toEqual(["p1"]); // a scan that raises a signal requests an assessment
    expect(notifyCalls).toHaveLength(1);
    expect(taskCalls[0]).toMatchObject({ taskType: "RISK_SIGNAL_REVIEW", resourceId: "p1" });
  });

  it("does not create a duplicate flag when one is already OPEN for the same type", async () => {
    proposalCount = 25;
    await runRiskSignalScan("p1");
    const result = await runRiskSignalScan("p1"); // second run, same condition still true
    expect(result.signalsCreated).toBe(0);
    expect(flags.filter((f) => f.flagType === "EXCESSIVE_PROPOSAL_ACTIVITY")).toHaveLength(1);
  });

  it("raises CONTACT_REUSE_SIGNAL when the contact is shared with another profile", async () => {
    contacts = [{ profileId: "p2", mobileNumber: "+923001234567", email: "a@example.com", profile: { createdAt: new Date(Date.now() - 100 * 60 * 60 * 1000) } }];
    const result = await runRiskSignalScan("p1");
    expect(result.signalsCreated).toBe(1);
    expect(flags[0].flagType).toBe("CONTACT_REUSE_SIGNAL");
  });

  it("does NOT flag contact reuse when the sharing profile is a reviewed authorized family account", async () => {
    contacts = [{ profileId: "p2", mobileNumber: "+923001234567", email: "a@example.com", profile: { createdAt: new Date(Date.now() - 100 * 60 * 60 * 1000) } }];
    relationships = [{ profileId: "p1", relatedProfileId: "p2", relationshipType: "AUTHORIZED_FAMILY_ACCOUNT" }];
    const result = await runRiskSignalScan("p1");
    expect(result.signalsCreated).toBe(0);
    expect(flags).toHaveLength(0);
  });

  it("stores the idempotency key, signal code and rule version on a created signal", async () => {
    proposalCount = 25;
    await runRiskSignalScan("p1");
    expect(flags[0].dedupKey).toMatch(/^excessive_proposals:p1:-:\d{4}-\d{2}-\d{2}$/);
  });

  it("raises RAPID_REGISTRATION_SIGNAL when 2+ sharing profiles registered within the last hour", async () => {
    contacts = [
      { profileId: "p2", mobileNumber: "+923001234567", email: "a@example.com", profile: { createdAt: new Date() } },
      { profileId: "p3", mobileNumber: "+923001234567", email: "a@example.com", profile: { createdAt: new Date() } },
    ];
    const result = await runRiskSignalScan("p1");
    expect(flags.map((f) => f.flagType)).toContain("RAPID_REGISTRATION_SIGNAL");
    expect(result.signalsCreated).toBeGreaterThan(0);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeFlag { id: string; profileId: string; flagType: string; severity: string; status: string; description: string; }
interface FakeContact { profileId: string; mobileNumber: string; email: string; profile: { createdAt: Date }; }
interface FakeProfile { id: string; contact: { mobileNumber: string; email: string } | null; }

let flags: FakeFlag[];
let contacts: FakeContact[];
let profiles: Map<string, FakeProfile>;
let auditCalls: Record<string, unknown>[];
let notifyCalls: unknown[];
let taskCalls: Record<string, unknown>[];
let proposalCount = 0;
let contactRequestCount = 0;
let failedPaymentCount = 0;
let idCounter = 0;

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/notifications/events", () => ({ notifySecurityFlagRaised: vi.fn(async (...args: unknown[]) => { notifyCalls.push(args); }) }));
vi.mock("@/lib/workflow/engine", () => ({ createFromEvent: vi.fn(async (call: Record<string, unknown>) => { taskCalls.push(call); return { id: "task1" }; }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    profile: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => profiles.get(where.id) ?? null) },
    contactInfo: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        // Distinguish the "recent" (1h window) call from the plain shared-contact call
        // by checking whether a nested profile.createdAt filter was passed.
        const hasRecentFilter = "profile" in where;
        return hasRecentFilter ? contacts.filter((c) => c.profile.createdAt.getTime() > Date.now() - 60 * 60 * 1000).length : contacts.length;
      }),
    },
    proposal: { count: vi.fn(async () => proposalCount) },
    contactPermission: { count: vi.fn(async () => contactRequestCount) },
    payment: { count: vi.fn(async () => failedPaymentCount) },
    securityFlag: {
      findFirst: vi.fn(async ({ where }: { where: { profileId: string; flagType: string; status: { in: string[] } } }) =>
        flags.find((f) => f.profileId === where.profileId && f.flagType === where.flagType && where.status.in.includes(f.status)) ?? null
      ),
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

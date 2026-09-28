import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
let events: Row[];
let newProfiles: Row[];
let overdue: Row[];
let caseEvents: Row[];
let evaluated: string[];
let failFor: string | null;
let adminNotified: Row[];
let assigneeNotified: Row[];

vi.mock("@/lib/risk/rule-engine", () => ({ RiskRuleEngine: { evaluateProfile: vi.fn(async (id: string) => { if (id === failFor) throw new Error("boom"); evaluated.push(id); return { signalsCreated: id === "p1" ? 1 : 0 }; }) } }));
vi.mock("@/lib/risk/signal-engine", () => ({ runRiskSignalScan: vi.fn(async () => ({ profilesScanned: 1, signalsCreated: 0 })) }));
vi.mock("@/lib/risk/assessment-service", () => ({ assessProfile: vi.fn(async () => ({})) }));
vi.mock("@/lib/risk/duplicate-cluster-service", () => ({ rebuildDuplicateClusters: vi.fn(async () => ({ clusters: 2, created: 1, superseded: 0 })) }));
vi.mock("@/lib/risk/technical-controls", () => ({ expireDueControls: vi.fn(async () => 3) }));
vi.mock("@/lib/security/event-bus", () => ({ sweepSecurityEvents: vi.fn(async () => ({ deleted: 7, skipped: 0, reviewRequired: false })) }));
vi.mock("@/lib/notifications/notification-service", () => ({
  notifyAdmins: vi.fn(async (n: Row) => { adminNotified.push(n); }),
  sendNotification: vi.fn(async (n: Row) => { assigneeNotified.push(n); }),
}));
vi.mock("@/lib/risk/case-service", () => ({ ACTIVE_CASE_STATUSES: ["OPEN", "ESCALATED"] }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    securityEvent: { findMany: vi.fn(async () => events) },
    profile: { findMany: vi.fn(async () => newProfiles) },
    riskCase: { findMany: vi.fn(async () => overdue) },
    riskCaseEvent: {
      findFirst: vi.fn(async ({ where }: { where: { riskCaseId: string } }) => caseEvents.find((e) => e.riskCaseId === where.riskCaseId) ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => { caseEvents.push(data); return data; }),
    },
  },
}));

const { runRiskBatch, sendRiskReviewReminders } = await import("./batch");

beforeEach(() => {
  events = []; newProfiles = []; overdue = []; caseEvents = []; evaluated = []; failFor = null; adminNotified = []; assigneeNotified = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("runRiskBatch", () => {
  it("evaluates recently active and newly created profiles once each, then runs the housekeeping tasks", async () => {
    events = [{ profileId: "p1" }, { profileId: "p2" }];
    newProfiles = [{ id: "p2" }, { id: "p3" }];
    const r = await runRiskBatch();
    expect(evaluated.sort()).toEqual(["p1", "p2", "p3"]);
    expect(r).toMatchObject({ profilesEvaluated: 3, signalsCreated: 1, truncated: false, expiredControls: 3, eventsSwept: 7, clusters: { clusters: 2, created: 1, superseded: 0 } });
  });

  it("one failing profile never stops the rest of the batch (isolated, logged)", async () => {
    events = [{ profileId: "p1" }, { profileId: "bad" }, { profileId: "p3" }];
    failFor = "bad";
    const r = await runRiskBatch();
    expect(evaluated).toEqual(["p1", "p3"]);
    expect(r.profilesEvaluated).toBe(2);
  });
});

describe("sendRiskReviewReminders", () => {
  it("reminds the assignee, or the reviewer roles when unassigned, and never for an admin-subject case", async () => {
    overdue = [
      { id: "c1", assignedToId: "rev1", subjectProfileId: "p1", subjectAdminId: null },
      { id: "c2", assignedToId: null, subjectProfileId: "p2", subjectAdminId: null },
      { id: "c3", assignedToId: null, subjectProfileId: null, subjectAdminId: "adm1" },
    ];
    expect(await sendRiskReviewReminders()).toBe(3);
    expect(assigneeNotified).toEqual([{ adminId: "rev1", type: "RISK_REVIEW_DUE", data: { relatedProfileId: "p1" } }]);
    expect(adminNotified).toHaveLength(1);
    expect(adminNotified[0]).toMatchObject({ type: "RISK_REVIEW_DUE", roles: ["VERIFICATION_MANAGER", "SUPPORT_MANAGER"] });
  });

  it("sends at most ONE reminder per case per day", async () => {
    overdue = [{ id: "c1", assignedToId: "rev1", subjectProfileId: "p1", subjectAdminId: null }];
    expect(await sendRiskReviewReminders()).toBe(1);
    expect(await sendRiskReviewReminders()).toBe(0);
    expect(assigneeNotified).toHaveLength(1);
  });
});

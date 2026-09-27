import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeRule { id: string; ruleCode: string; status: string; effectiveTo: Date | null; }
interface FakeProcessor { id: string; processorCode: string; name: string; serviceType: string; nextReviewDue: Date | null; }
interface FakeAuthorityRequest { id: string; requestCode: string; authority: string; deadline: Date | null; legalReviewStatus: string; }

let rules: FakeRule[];
let processors: FakeProcessor[];
let authorityRequests: FakeAuthorityRequest[];
let eventCalls: Record<string, unknown>[];
let notifyCalls: Record<string, unknown>[];

vi.mock("@/lib/workflow/engine", () => ({ createFromEvent: vi.fn(async (call: Record<string, unknown>) => { eventCalls.push(call); return { id: "task1" }; }) }));
vi.mock("@/lib/notifications/notification-service", () => ({ notifyAdmins: vi.fn(async (call: Record<string, unknown>) => { notifyCalls.push(call); }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    complianceRule: {
      findMany: vi.fn(async ({ where }: { where: { status: string; effectiveTo: { gt?: Date; lte: Date } } }) =>
        rules.filter((r) => r.status === where.status && r.effectiveTo && r.effectiveTo <= where.effectiveTo.lte && (!where.effectiveTo.gt || r.effectiveTo > where.effectiveTo.gt))
      ),
    },
    complianceProcessor: {
      findMany: vi.fn(async ({ where }: { where: { nextReviewDue: { lte: Date } } }) => processors.filter((p) => p.nextReviewDue && p.nextReviewDue <= where.nextReviewDue.lte)),
    },
    authorityRequest: {
      findMany: vi.fn(async ({ where }: { where: { deadline: { lte: Date }; legalReviewStatus: { in: string[] } } }) =>
        authorityRequests.filter((r) => r.deadline && r.deadline <= where.deadline.lte && where.legalReviewStatus.in.includes(r.legalReviewStatus))
      ),
    },
  },
}));

const { runComplianceReminders } = await import("./reminders");

beforeEach(() => {
  rules = [];
  processors = [];
  authorityRequests = [];
  eventCalls = [];
  notifyCalls = [];
});

describe("runComplianceReminders", () => {
  it("does nothing when nothing is due", async () => {
    const result = await runComplianceReminders();
    expect(result).toEqual({ rules: { expiring: 0, expired: 0 }, processors: { due: 0 }, authorityRequests: { due: 0 } });
    expect(eventCalls).toHaveLength(0);
    expect(notifyCalls).toHaveLength(0);
  });

  it("flags an ACTIVE rule expiring within 30 days as COMPLIANCE_RULE_EXPIRING", async () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 10);
    rules.push({ id: "r1", ruleCode: "LPP-CRULE-000001", status: "ACTIVE", effectiveTo: soon });

    await runComplianceReminders();
    expect(eventCalls.find((c) => c.eventName === "COMPLIANCE_RULE_EXPIRING")).toBeTruthy();
    expect(notifyCalls.find((c) => c.type === "COMPLIANCE_RULE_EXPIRING")).toBeTruthy();
  });

  it("flags an ACTIVE rule whose effectiveTo already passed as COMPLIANCE_RULE_EXPIRED, not EXPIRING", async () => {
    const past = new Date();
    past.setDate(past.getDate() - 5);
    rules.push({ id: "r1", ruleCode: "LPP-CRULE-000001", status: "ACTIVE", effectiveTo: past });

    await runComplianceReminders();
    expect(eventCalls.find((c) => c.eventName === "COMPLIANCE_RULE_EXPIRED")).toBeTruthy();
    expect(eventCalls.find((c) => c.eventName === "COMPLIANCE_RULE_EXPIRING")).toBeUndefined();
  });

  it("never flags a rule expiring more than 30 days out", async () => {
    const far = new Date();
    far.setDate(far.getDate() + 60);
    rules.push({ id: "r1", ruleCode: "LPP-CRULE-000001", status: "ACTIVE", effectiveTo: far });

    await runComplianceReminders();
    expect(eventCalls).toHaveLength(0);
  });

  it("flags a processor whose nextReviewDue has passed", async () => {
    const past = new Date();
    past.setDate(past.getDate() - 1);
    processors.push({ id: "p1", processorCode: "LPP-PROC-000001", name: "Acme KYC", serviceType: "IDENTITY_VERIFICATION", nextReviewDue: past });

    await runComplianceReminders();
    expect(eventCalls.find((c) => c.eventName === "COMPLIANCE_PROVIDER_REVIEW_DUE")).toBeTruthy();
  });

  it("flags an authority request nearing its deadline while still under review, but not one already APPROVED", async () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 1);
    authorityRequests.push({ id: "a1", requestCode: "LPP-AUTHREQ-000001", authority: "Local Police", deadline: soon, legalReviewStatus: "PENDING" });
    authorityRequests.push({ id: "a2", requestCode: "LPP-AUTHREQ-000002", authority: "Regulator", deadline: soon, legalReviewStatus: "APPROVED" });

    await runComplianceReminders();
    const authorityEvents = eventCalls.filter((c) => c.eventName === "COMPLIANCE_AUTHORITY_REQUEST_DUE");
    expect(authorityEvents).toHaveLength(1);
    expect(authorityEvents[0]).toMatchObject({ resourceId: "a1", priority: "HIGH" });
  });
});

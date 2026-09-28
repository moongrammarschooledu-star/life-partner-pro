import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
let cases: Row[];
let flags: Row[];
let reviews: Row[];
let events: Row[];
let restrictionsApplied: Row[];
let lifted: string[];
let suspended: Row[];
let reverif: Row[];
let notifications: Row[];
let adminNotifications: Row[];
let tasks: Row[];
let audits: Row[];
let gateResult: { requiresApproval: boolean; status?: string; approvalRequestId?: string; approvalCode?: string };
let gateCalls: Row[];
let executed: string[];
let idc = 0;

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async () => `LPP-RISK-${String(++idc).padStart(6, "0")}`) }));
vi.mock("@/lib/workflow/engine", () => ({ createFromEvent: vi.fn(async (t: Row) => { tasks.push(t); return { id: "t1" }; }) }));
vi.mock("@/lib/approvals/gate", () => ({
  enforceApprovalGate: vi.fn(async (p: Row) => { gateCalls.push(p); return gateResult; }),
  markApprovalExecuted: vi.fn(async (id: string) => { executed.push(id); }),
}));
vi.mock("@/lib/notifications/notification-service", () => ({
  sendNotification: vi.fn(async (n: Row) => { notifications.push(n); }),
  notifyAdmins: vi.fn(async (n: Row) => { adminNotifications.push(n); }),
}));
vi.mock("@/lib/verification/status", () => ({
  suspendProfile: vi.fn(async (id: string, o: Row) => { suspended.push({ id, ...o }); }),
  setVerificationStatus: vi.fn(async (id: string, s: string, o: Row) => { reverif.push({ id, s, ...o }); }),
}));
vi.mock("@/lib/profile-restrictions", () => ({
  applyRestriction: vi.fn(async (p: Row) => { restrictionsApplied.push(p); return { id: `r${restrictionsApplied.length}` }; }),
  liftRestriction: vi.fn(async (id: string) => { lifted.push(id); }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    riskRule: { findMany: vi.fn(async () => []) },
    adminUser: { findMany: vi.fn(async () => [{ id: "sa1" }, { id: "adm-subject" }].filter((a) => a.id !== "adm-subject")) },
    profileRestriction: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async ({ where }: { where: Row }) => (where.riskCaseId ? [{ id: "rr1" }, { id: "rr2" }] : [])),
    },
    securityFlag: {
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        for (const f of flags) if (f.riskCaseId === where.riskCaseId || (where.id as { in: string[] } | undefined)?.in?.includes(f.id as string)) Object.assign(f, data);
        return { count: 1 };
      }),
    },
    riskCase: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const c = cases.find((x) => x.id === where.id); return c ? { ...c } : null; }),
      findFirst: vi.fn(async ({ where }: { where: Row }) => cases.find((c) => (where.status as { in: string[] }).in.includes(c.status as string) && c.category === where.category && (where.subjectAdminId ? c.subjectAdminId === where.subjectAdminId : c.subjectProfileId === where.subjectProfileId)) ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => { const c = { id: `c${cases.length + 1}`, status: "OPEN", assignedToId: null, ...data }; cases.push(c); return c; }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => { const c = cases.find((x) => x.id === where.id) as Row; Object.assign(c, data); return c; }),
    },
    riskCaseEvent: { create: vi.fn(async ({ data }: { data: Row }) => { events.push(data); return data; }) },
    riskReview: { create: vi.fn(async ({ data }: { data: Row }) => { reviews.push(data); return data; }) },
  },
}));

const svc = await import("./case-service");

const admin = (over: Row = {}) => ({ id: "a1", name: "A", email: "a@x", role: "SUPPORT_MANAGER", permissions: ["risk:view"], sid: "s", ...over }) as never;
const fullChecklist = { evidenceReviewed: true, falsePositivesConsidered: true, lessRestrictiveOptionConsidered: true };
const seedCase = (over: Row = {}) => {
  const c = { id: "c1", riskCode: "LPP-RISK-000001", subjectProfileId: "p1", subjectAdminId: null, category: "CONTACT", status: "UNDER_INVESTIGATION", riskLevel: "HIGH", riskState: "UNDER_REVIEW", assignedToId: "a1", ...over };
  cases.push(c);
  return c;
};

beforeEach(() => {
  cases = []; flags = []; reviews = []; events = []; restrictionsApplied = []; lifted = []; suspended = []; reverif = [];
  notifications = []; adminNotifications = []; tasks = []; audits = []; gateCalls = []; executed = []; idc = 0;
  gateResult = { requiresApproval: false };
});

describe("state machine", () => {
  it("only allows actions from the documented states", () => {
    expect(svc.isActionAllowed("OPEN", "ACKNOWLEDGE")).toBe(true);
    expect(svc.isActionAllowed("ACKNOWLEDGED", "ACKNOWLEDGE")).toBe(false);
    // adverse actions are impossible on a case nobody has looked at yet
    expect(svc.isActionAllowed("OPEN", "RESTRICT")).toBe(false);
    expect(svc.isActionAllowed("OPEN", "SUSPEND")).toBe(false);
    expect(svc.isActionAllowed("UNDER_INVESTIGATION", "RESTRICT")).toBe(true);
    // a terminal case cannot be re-decided
    expect(svc.isActionAllowed("CLEARED", "SUSPEND")).toBe(false);
    expect(svc.isActionAllowed("FALSE_POSITIVE", "RESTRICT")).toBe(false);
    expect(svc.isActionAllowed("CLOSED", "CLOSE")).toBe(false);
  });
});

describe("visibility (admin-subject cases)", () => {
  it("a normal case is visible to any admin who passes the route permission", () => {
    expect(svc.canViewCase({ id: "a1", permissions: [] }, { subjectAdminId: null })).toBe(true);
  });
  it("the subject admin can NEVER view their own case, even with every permission", () => {
    expect(svc.canViewCase({ id: "adm-subject", permissions: ["sensitive:security:view", "security:incidents:manage"] }, { subjectAdminId: "adm-subject" })).toBe(false);
  });
  it("other admins need a security permission to see an admin-subject case", () => {
    expect(svc.canViewCase({ id: "a1", permissions: ["risk:view"] }, { subjectAdminId: "adm-subject" })).toBe(false);
    expect(svc.canViewCase({ id: "a1", permissions: ["sensitive:security:view"] }, { subjectAdminId: "adm-subject" })).toBe(true);
  });
  it("hidden and missing cases produce the same 404 (no existence oracle)", async () => {
    seedCase({ id: "hidden", subjectProfileId: null, subjectAdminId: "adm-subject" });
    await expect(svc.getRiskCaseForActor("hidden", { id: "adm-subject", permissions: ["sensitive:security:view"] })).rejects.toMatchObject({ status: 404 });
    await expect(svc.getRiskCaseForActor("missing", { id: "a1", permissions: [] })).rejects.toMatchObject({ status: 404 });
  });
  it("the subject admin cannot act on their own case", async () => {
    seedCase({ id: "own", subjectProfileId: null, subjectAdminId: "a1" });
    await expect(svc.applyCaseAction("own", { action: "CLEAR", actor: admin(), reason: "trying to clear myself" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("openRiskCase", () => {
  it("opens a case that only REQUESTS review: task, audit, timeline, neutral title", async () => {
    const r = await svc.openRiskCase({ subjectProfileId: "p1", category: "CONTACT", title: "x", riskLevel: "HIGH", openedBy: "assessment", signalIds: ["f1"] });
    expect(r.created).toBe(true);
    expect(cases[0]).toMatchObject({ status: "OPEN", reviewRequired: true, riskState: "UNDER_REVIEW" });
    expect(tasks[0]).toMatchObject({ taskType: "RISK_REVIEW", dedupKey: `RISK_REVIEW:${r.riskCase.id}`, resourceType: "PROFILE", resourceId: "p1" });
    expect(String(tasks[0].title)).toMatch(/^Risk review LPP-RISK-/);
    expect(String(tasks[0].description)).toMatch(/No adverse action has been taken/);
    expect(events[0]).toMatchObject({ eventType: "CASE_OPENED" });
    expect(audits[0]).toMatchObject({ action: "RISK_CASE_OPENED" });
    expect(adminNotifications[0]).toMatchObject({ type: "HIGH_RISK_DETECTED" });
    expect(restrictionsApplied).toHaveLength(0);
    expect(suspended).toHaveLength(0);
  });

  it("is idempotent: a second call links signals to the live case instead of creating another", async () => {
    await svc.openRiskCase({ subjectProfileId: "p1", category: "CONTACT", title: "x", riskLevel: "MEDIUM", openedBy: "assessment" });
    const again = await svc.openRiskCase({ subjectProfileId: "p1", category: "CONTACT", title: "x", riskLevel: "CRITICAL", openedBy: "assessment", signalIds: ["f2"] });
    expect(again.created).toBe(false);
    expect(cases).toHaveLength(1);
    expect(cases[0].riskLevel).toBe("CRITICAL"); // level only ever raised by new evidence here
  });

  it("an admin-subject case uses the ADMIN_SECURITY_REVIEW task and never notifies the subject", async () => {
    await svc.openRiskCase({ subjectAdminId: "adm-subject", category: "ADMIN_ACCESS", title: "Unusual privileged-access volume", riskLevel: "MEDIUM", openedBy: "rule-engine" });
    expect(tasks[0]).toMatchObject({ taskType: "ADMIN_SECURITY_REVIEW", resourceType: "ADMIN_USER", resourceId: "adm-subject" });
    expect(String(tasks[0].title)).not.toMatch(/adm-subject/);
    expect(notifications.every((n) => n.adminId !== "adm-subject")).toBe(true);
    expect(adminNotifications).toHaveLength(0);
  });

  it("refuses a case with no subject", async () => {
    await expect(svc.openRiskCase({ category: "CONTACT", title: "x", riskLevel: "LOW", openedBy: "x" })).rejects.toMatchObject({ status: 422 });
  });
});

describe("no automated adverse action", () => {
  it("restrict / suspend exist only in case-service and need a human actor (structural)", async () => {
    const { readFileSync, readdirSync } = await import("fs");
    const { join } = await import("path");
    const dir = join(process.cwd(), "src/lib/risk");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      if (file === "case-service.ts" || file === "restriction-service.ts") continue;
      const text = readFileSync(join(dir, file), "utf8");
      expect(text, file).not.toMatch(/suspendProfile\(|applyRestriction\(|applyRiskRestrictions\(/);
    }
    const bus = readFileSync(join(process.cwd(), "src/lib/security/event-bus.ts"), "utf8");
    expect(bus).not.toMatch(/suspendProfile\(|applyRestriction\(|applyRiskRestrictions\(/);
  });
});

describe("applyCaseAction — review", () => {
  it("ACKNOWLEDGE moves OPEN → ACKNOWLEDGED with a review row, timeline event and audit", async () => {
    seedCase({ status: "OPEN" });
    const r = await svc.applyCaseAction("c1", { action: "ACKNOWLEDGE", actor: admin() });
    expect(r.approvalRequired).toBe(false);
    expect(cases[0].status).toBe("ACKNOWLEDGED");
    expect(reviews[0]).toMatchObject({ decision: "ACKNOWLEDGE", reviewerId: "a1" });
    expect(events.at(-1)).toMatchObject({ eventType: "REVIEW_ACTION" });
    expect(audits.at(-1)).toMatchObject({ action: "RISK_CASE_ACTION", meta: { action: "ACKNOWLEDGE", from: "OPEN", to: "ACKNOWLEDGED" } });
  });

  it("rejects an action that is not valid for the current state with 409", async () => {
    seedCase({ status: "OPEN" });
    await expect(svc.applyCaseAction("c1", { action: "RESTRICT", actor: admin(), reason: "because", checklist: fullChecklist, restrictionTypes: ["MATCHING"], endDate: new Date(Date.now() + 86_400_000) })).rejects.toMatchObject({ status: 409 });
    expect(restrictionsApplied).toHaveLength(0);
  });

  it("dismissal and clearing require a reason", async () => {
    seedCase();
    await expect(svc.applyCaseAction("c1", { action: "DISMISS", actor: admin() })).rejects.toMatchObject({ status: 422 });
    await expect(svc.applyCaseAction("c1", { action: "CLEAR", actor: admin(), reason: "no" })).rejects.toMatchObject({ status: 422 });
  });

  it("MARK_FALSE_POSITIVE needs a structured reason and stamps it on the signals; history is kept", async () => {
    seedCase();
    flags = [{ id: "f1", riskCaseId: "c1", status: "OPEN" }];
    await expect(svc.applyCaseAction("c1", { action: "MARK_FALSE_POSITIVE", actor: admin(), reason: "shared phone" })).rejects.toMatchObject({ status: 422 });
    await svc.applyCaseAction("c1", { action: "MARK_FALSE_POSITIVE", actor: admin(), reason: "shared family phone", falsePositiveReason: "SHARED_FAMILY_PHONE" });
    expect(flags[0]).toMatchObject({ status: "FALSE_POSITIVE", falsePositiveReason: "SHARED_FAMILY_PHONE", resolvedById: "a1" });
    expect(cases[0]).toMatchObject({ status: "FALSE_POSITIVE", riskState: "CLEARED", closedById: "a1" });
    expect(reviews).toHaveLength(1); // the decision is recorded, never deleted
  });

  it("CLEAR resolves the signals and lifts the restrictions this case applied", async () => {
    seedCase({ status: "RESTRICTED" });
    flags = [{ id: "f1", riskCaseId: "c1", status: "OPEN" }];
    await svc.applyCaseAction("c1", { action: "CLEAR", actor: admin(), reason: "verified as legitimate" });
    expect(lifted).toEqual(["rr1", "rr2"]);
    expect(flags[0].status).toBe("RESOLVED");
    expect(cases[0].riskState).toBe("CLEARED");
  });

  it("CLOSE needs an outcome and never lifts anything", async () => {
    seedCase({ status: "RESTRICTED" });
    await expect(svc.applyCaseAction("c1", { action: "CLOSE", actor: admin() })).rejects.toMatchObject({ status: 422 });
    await svc.applyCaseAction("c1", { action: "CLOSE", actor: admin(), outcome: "Restriction runs to its end date." });
    expect(lifted).toHaveLength(0);
    expect(cases[0].status).toBe("CLOSED");
  });

  it("REQUEST_INFORMATION sends only the neutral applicant notice", async () => {
    seedCase();
    await svc.applyCaseAction("c1", { action: "REQUEST_INFORMATION", actor: admin() });
    expect(notifications).toEqual([{ profileId: "p1", type: "RISK_INFORMATION_REQUESTED", data: {} }]);
    expect(cases[0].status).toBe("INFORMATION_REQUESTED");
  });

  it("REQUEST_REVERIFICATION triggers the existing re-verification flow", async () => {
    seedCase();
    await svc.applyCaseAction("c1", { action: "REQUEST_REVERIFICATION", actor: admin(), reason: "please re-verify" });
    expect(reverif[0]).toMatchObject({ id: "p1", s: "RE_VERIFICATION_REQUIRED", adminId: "a1" });
  });

  it("ESCALATE notifies senior roles", async () => {
    seedCase();
    await svc.applyCaseAction("c1", { action: "ESCALATE", actor: admin(), reason: "needs senior review" });
    expect(cases[0].status).toBe("ESCALATED");
    expect(adminNotifications.at(-1)).toMatchObject({ type: "RISK_CASE_ESCALATED" });
  });

  it("applicant-only actions are refused on an admin-subject case", async () => {
    seedCase({ id: "ac", subjectProfileId: null, subjectAdminId: "adm-subject" });
    await expect(svc.applyCaseAction("ac", { action: "RESTRICT", actor: admin({ permissions: ["sensitive:security:view"] }), reason: "because", checklist: fullChecklist, restrictionTypes: ["LOGIN"], endDate: new Date(Date.now() + 86_400_000) })).rejects.toMatchObject({ status: 422 });
  });
});

describe("applyCaseAction — restrict (human-reviewed, approval-gated)", () => {
  const future = () => new Date(Date.now() + 7 * 86_400_000);

  it("needs the complete review checklist", async () => {
    seedCase();
    await expect(svc.applyCaseAction("c1", { action: "RESTRICT", actor: admin(), reason: "policy breach suspected", restrictionTypes: ["MATCHING"], endDate: future(), checklist: { evidenceReviewed: true } })).rejects.toMatchObject({ status: 422 });
    expect(gateCalls).toHaveLength(0);
    expect(restrictionsApplied).toHaveLength(0);
  });

  it("goes through the STEP 19 gate: while approval is pending NOTHING is applied", async () => {
    seedCase();
    gateResult = { requiresApproval: true, status: "CREATED", approvalRequestId: "ap1", approvalCode: "LPP-APR-000001" };
    const r = await svc.applyCaseAction("c1", { action: "RESTRICT", actor: admin(), reason: "policy breach suspected", restrictionTypes: ["MATCHING"], endDate: future(), checklist: fullChecklist });
    expect(r).toMatchObject({ approvalRequired: true, approvalCode: "LPP-APR-000001" });
    expect(gateCalls[0]).toMatchObject({ actionType: "PROFILE_RESTRICT", sourceType: "PROFILE", sourceId: "p1" });
    expect(restrictionsApplied).toHaveLength(0);
    expect(cases[0].status).toBe("UNDER_INVESTIGATION");
    expect(reviews).toHaveLength(0);
  });

  it("applies a TEMPORARY restriction once approved, marks the approval executed, sends only a neutral notice", async () => {
    seedCase();
    gateResult = { requiresApproval: true, status: "READY_TO_EXECUTE", approvalRequestId: "ap1", approvalCode: "LPP-APR-000001" };
    const end = future();
    const r = await svc.applyCaseAction("c1", { action: "RESTRICT", actor: admin(), reason: "policy breach suspected", restrictionTypes: ["MATCHING", "CONTACT"], endDate: end, checklist: fullChecklist });
    expect(r.approvalRequired).toBe(false);
    expect(restrictionsApplied.map((x) => x.restrictionType).sort()).toEqual(["CANNOT_CONTACT_SHARE", "CANNOT_MATCH"]);
    expect(restrictionsApplied[0]).toMatchObject({ source: "risk_case", riskCaseId: "c1", approvalId: "ap1", isPermanent: false, endDate: end, appliedById: "a1" });
    expect(executed).toEqual(["ap1"]);
    expect(cases[0]).toMatchObject({ status: "RESTRICTED", riskState: "RESTRICTED" });
    expect(notifications).toEqual([{ profileId: "p1", type: "SECURITY_NOTICE", data: {} }]);
  });

  it("refuses a restriction with no end date (temporary is the default)", async () => {
    seedCase();
    await expect(svc.applyCaseAction("c1", { action: "RESTRICT", actor: admin(), reason: "policy breach suspected", restrictionTypes: ["MATCHING"], checklist: fullChecklist })).rejects.toMatchObject({ status: 422 });
    expect(restrictionsApplied).toHaveLength(0);
  });

  it("a PERMANENT restriction uses the PERMANENT_RESTRICTION approval and is refused if policy gives no approval on record", async () => {
    seedCase();
    gateResult = { requiresApproval: false };
    await expect(svc.applyCaseAction("c1", { action: "RESTRICT", actor: admin(), reason: "confirmed misuse", restrictionTypes: ["FULL_ACCOUNT"], permanent: true, checklist: fullChecklist })).rejects.toMatchObject({ status: 403 });
    expect(gateCalls[0]).toMatchObject({ actionType: "PERMANENT_RESTRICTION" });
    expect(restrictionsApplied).toHaveLength(0);

    gateResult = { requiresApproval: true, status: "READY_TO_EXECUTE", approvalRequestId: "ap9", approvalCode: "LPP-APR-000009" };
    await svc.applyCaseAction("c1", { action: "RESTRICT", actor: admin(), reason: "confirmed misuse", restrictionTypes: ["FULL_ACCOUNT"], permanent: true, checklist: fullChecklist });
    expect(restrictionsApplied[0]).toMatchObject({ restrictionType: "FULL_ACCOUNT_RESTRICTED", isPermanent: true, approvalId: "ap9", endDate: null });
  });

  it("rejects unknown restriction names", async () => {
    seedCase();
    await expect(svc.applyCaseAction("c1", { action: "RESTRICT", actor: admin(), reason: "policy breach suspected", restrictionTypes: ["BAN_FOREVER"], endDate: future(), checklist: fullChecklist })).rejects.toMatchObject({ status: 422 });
  });
});

describe("applyCaseAction — suspend", () => {
  it("is gated (PROFILE_SUSPEND), needs the checklist, and suspends only after approval", async () => {
    seedCase();
    await expect(svc.applyCaseAction("c1", { action: "SUSPEND", actor: admin(), reason: "serious concern confirmed" })).rejects.toMatchObject({ status: 422 });

    gateResult = { requiresApproval: true, status: "ALREADY_PENDING", approvalRequestId: "ap2", approvalCode: "LPP-APR-000002" };
    const pending = await svc.applyCaseAction("c1", { action: "SUSPEND", actor: admin(), reason: "serious concern confirmed", checklist: fullChecklist });
    expect(pending.approvalRequired).toBe(true);
    expect(gateCalls.at(-1)).toMatchObject({ actionType: "PROFILE_SUSPEND" });
    expect(suspended).toHaveLength(0);

    gateResult = { requiresApproval: true, status: "READY_TO_EXECUTE", approvalRequestId: "ap2", approvalCode: "LPP-APR-000002" };
    await svc.applyCaseAction("c1", { action: "SUSPEND", actor: admin(), reason: "serious concern confirmed", checklist: fullChecklist });
    expect(suspended[0]).toMatchObject({ id: "p1", adminId: "a1" });
    expect(String(suspended[0].reason)).toContain("LPP-RISK-000001");
    expect(executed).toEqual(["ap2"]);
    expect(cases[0]).toMatchObject({ status: "SUSPENDED", riskState: "SUSPENDED" });
  });
});

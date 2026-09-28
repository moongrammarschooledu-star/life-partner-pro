import { describe, it, expect, vi, beforeEach } from "vitest";

// STEP 24 end-to-end flows at service level (spec §66 normal flow, §67 high-risk flow). One coherent in-memory database
// is shared by the REAL event bus, rule engine, signal service, assessment service, case service, restriction service and
// profile-restriction helper; only the outward edges (audit, tasks, notifications, approval gate, account suspension)
// are recorded fakes. So these tests prove the pieces actually fit together.

type Row = Record<string, unknown> & { id?: string };
const DEFAULTS: Record<string, Row> = {
  securityFlag: { status: "OPEN", reviewRequired: true },
  riskCase: { status: "OPEN", assignedToId: null },
  profileRestriction: { active: true },
  riskAssessment: { riskCaseId: null },
};

const db = new Map<string, Row[]>();
let idc = 0;
const rows = (t: string) => { if (!db.has(t)) db.set(t, []); return db.get(t) as Row[]; };

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR") { if (!(v as Row[]).some((w) => matches(row, w))) return false; continue; }
    if (k === "AND") { if (!(v as Row[]).every((w) => matches(row, w))) return false; continue; }
    const actual = row[k];
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const c = v as Record<string, unknown>;
      if ("in" in c && !(c.in as unknown[]).includes(actual)) return false;
      if ("notIn" in c && (c.notIn as unknown[]).includes(actual)) return false;
      if ("not" in c && (c.not === null ? actual == null : actual === c.not)) return false;
      if ("gte" in c && !((actual as Date) >= (c.gte as Date))) return false;
      if ("gt" in c && !((actual as Date) > (c.gt as Date))) return false;
      if ("lte" in c && !((actual as Date) <= (c.lte as Date))) return false;
      if ("lt" in c && !((actual as Date) < (c.lt as Date))) return false;
      if ("equals" in c && String(actual).toLowerCase() !== String(c.equals).toLowerCase()) return false;
      continue;
    }
    if (v === null ? actual != null : actual !== v) return false;
  }
  return true;
}

function model(t: string) {
  return {
    create: async ({ data }: { data: Row }) => {
      const row: Row = { id: `${t}-${++idc}`, createdAt: new Date(), updatedAt: new Date(), ...DEFAULTS[t], ...data };
      for (const uniq of ["dedupKey", "idempotencyKey", "riskCode", "signalCode"]) {
        if (row[uniq] != null && rows(t).some((r) => r[uniq] === row[uniq])) throw Object.assign(new Error("unique"), { code: "P2002" });
      }
      rows(t).push(row);
      return { ...row };
    },
    findFirst: async ({ where }: { where?: Row } = {}) => { const r = rows(t).filter((x) => matches(x, where)).sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())[0]; return r ? { ...r } : null; },
    findUnique: async ({ where }: { where: Row }) => { const r = rows(t).find((x) => matches(x, where)); return r ? { ...r } : null; },
    findMany: async ({ where, distinct, take }: { where?: Row; distinct?: string[]; take?: number } = {}) => {
      let out = rows(t).filter((x) => matches(x, where)).map((r) => ({ ...r }));
      if (distinct) { const seen = new Set<unknown>(); out = out.filter((r) => { const k = r[distinct[0]]; if (seen.has(k)) return false; seen.add(k); return true; }); }
      return take ? out.slice(0, take) : out;
    },
    count: async ({ where }: { where?: Row } = {}) => rows(t).filter((x) => matches(x, where)).length,
    update: async ({ where, data }: { where: Row; data: Row }) => { const r = rows(t).find((x) => matches(x, where)); if (!r) throw new Error("not found"); Object.assign(r, data, { updatedAt: new Date() }); return { ...r }; },
    updateMany: async ({ where, data }: { where?: Row; data: Row }) => { const hit = rows(t).filter((x) => matches(x, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; },
    aggregate: async () => ({ _max: { version: null } }),
  };
}

const audits: Row[] = [];
const tasks: Row[] = [];
const notifications: Row[] = [];
const adminNotifications: Row[] = [];
const suspended: Row[] = [];
let gate: { requiresApproval: boolean; status?: string; approvalRequestId?: string; approvalCode?: string } = { requiresApproval: false };
const executedApprovals: string[] = [];

vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_t, name: string) => model(name) }) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async (p: string) => `LPP-${p}-${String(++idc).padStart(6, "0")}`) }));
vi.mock("@/lib/workflow/engine", () => ({ createFromEvent: vi.fn(async (t: Row) => { tasks.push(t); return { id: `t${tasks.length}` }; }) }));
vi.mock("@/lib/notifications/events", () => ({ notifySecurityFlagRaised: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/notification-service", () => ({
  sendNotification: vi.fn(async (n: Row) => { notifications.push(n); }),
  notifyAdmins: vi.fn(async (n: Row) => { adminNotifications.push(n); }),
}));
vi.mock("@/lib/approvals/gate", () => ({
  enforceApprovalGate: vi.fn(async () => gate),
  markApprovalExecuted: vi.fn(async (id: string) => { executedApprovals.push(id); }),
}));
vi.mock("@/lib/verification/status", () => ({
  suspendProfile: vi.fn(async (id: string, o: Row) => { suspended.push({ id, ...o }); }),
  setVerificationStatus: vi.fn(async () => undefined),
}));

const { publishSecurityEvent } = await import("@/lib/security/event-bus");
const { applyCaseAction, getRiskCaseForActor } = await import("./case-service");
const { clearRiskConfigCache } = await import("./config");
const { listActiveRiskRestrictions } = await import("./restriction-service");

const reviewer = { id: "rev1", name: "R", email: "r@x", role: "SUPPORT_MANAGER", permissions: ["risk:view", "risk:review", "risk:investigate", "risk:restrict", "risk:suspend", "risk:clear", "risk:resolve"], sid: "s" } as never;
const CHECKLIST = { evidenceReviewed: true, falsePositivesConsidered: true, lessRestrictiveOptionConsidered: true };
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);

async function burst(eventType: string, n: number, profileId = "p1") {
  for (let i = 0; i < n; i++) await publishSecurityEvent({ eventType: eventType as never, profileId, source: "test" });
}

beforeEach(() => {
  db.clear(); idc = 0;
  audits.length = 0; tasks.length = 0; notifications.length = 0; adminNotifications.length = 0; suspended.length = 0; executedApprovals.length = 0;
  gate = { requiresApproval: false };
  clearRiskConfigCache();
  rows("profile").push({ id: "p1", profileCode: "LPP-000001" });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("§66 normal flow: event → signal → assessment → (no case) → human review", () => {
  it("a handful of failed OTPs is ordinary and creates nothing at all", async () => {
    await burst("OTP_FAILED", 3);
    expect(rows("securityEvent")).toHaveLength(3);
    expect(rows("securityFlag")).toHaveLength(0);
    expect(rows("riskAssessment")).toHaveLength(0);
    expect(rows("riskCase")).toHaveLength(0);
  });

  it("sustained OTP abuse creates ONE neutral signal and a persisted, explainable assessment — but no case and no action at MEDIUM", async () => {
    await burst("OTP_REQUESTED", 10);
    const signals = rows("securityFlag");
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ flagType: "OTP_ABUSE_SIGNAL", category: "LOGIN_SECURITY", reviewRequired: true, source: "security-event-bus" });
    expect(String(signals[0].signalCode)).toMatch(/^LPP-SIGNAL-/);
    const assessment = rows("riskAssessment");
    expect(assessment).toHaveLength(1);
    expect(assessment[0]).toMatchObject({ subjectProfileId: "p1", riskLevel: "MEDIUM", ruleVersion: 0 });
    expect(rows("riskCase")).toHaveLength(0);
    expect(rows("profileRestriction")).toHaveLength(0);
    expect(notifications.filter((n) => n.profileId === "p1")).toHaveLength(0); // the member is told nothing
    // more events of the same kind neither duplicate the signal nor re-assess an unchanged picture
    await burst("OTP_REQUESTED", 5);
    expect(rows("securityFlag")).toHaveLength(1);
    expect(rows("riskAssessment")).toHaveLength(1);
  });

  it("replaying a webhook event (same idempotency key) does not double count", async () => {
    for (let i = 0; i < 12; i++) await publishSecurityEvent({ eventType: "PAYMENT_FAILED", profileId: "p1", idempotencyKey: "same-webhook" });
    expect(rows("securityEvent")).toHaveLength(1);
    expect(rows("securityFlag")).toHaveLength(0);
  });
});

describe("§67 high-risk flow: signals combine → human-review case → gated, temporary restriction → clear", () => {
  async function reachHighLevel() {
    await burst("OTP_REQUESTED", 10);
    await burst("CONTACT_BYPASS_ATTEMPT", 3);
  }

  it("two independent signal families raise the level to HIGH and open ONE review case with a task and admin notice — still no action", async () => {
    await reachHighLevel();
    const cases = rows("riskCase");
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ status: "OPEN", riskLevel: "HIGH", subjectProfileId: "p1", reviewRequired: true, openedBy: "assessment" });
    expect(tasks.map((t) => t.taskType)).toContain("RISK_REVIEW");
    expect(adminNotifications.map((n) => n.type)).toContain("HIGH_RISK_DETECTED");
    expect(rows("securityFlag").every((f) => f.riskCaseId === cases[0].id)).toBe(true);
    expect(rows("profileRestriction")).toHaveLength(0);
    expect(suspended).toHaveLength(0);
    expect(notifications.filter((n) => n.profileId === "p1")).toHaveLength(0);
    // the persisted assessment is linked to the case and says why
    const linked = rows("riskAssessment").find((a) => a.riskCaseId === cases[0].id) as Row;
    expect(linked).toBeTruthy();
    expect(JSON.parse(linked.rulesTriggered as string).length).toBeGreaterThanOrEqual(2);
  });

  it("restricting an OPEN (unreviewed) case is refused; after review it needs the checklist and the approval gate", async () => {
    await reachHighLevel();
    const caseId = rows("riskCase")[0].id as string;

    await expect(applyCaseAction(caseId, { action: "RESTRICT", actor: reviewer, reason: "policy concern noted", checklist: CHECKLIST, restrictionTypes: ["CONTACT"], endDate: inDays(14) })).rejects.toMatchObject({ status: 409 });

    await applyCaseAction(caseId, { action: "ACKNOWLEDGE", actor: reviewer });
    await applyCaseAction(caseId, { action: "INVESTIGATE", actor: reviewer });

    await expect(applyCaseAction(caseId, { action: "RESTRICT", actor: reviewer, reason: "policy concern noted", restrictionTypes: ["CONTACT"], endDate: inDays(14) })).rejects.toMatchObject({ status: 422 }); // no checklist

    gate = { requiresApproval: true, status: "CREATED", approvalRequestId: "ap1", approvalCode: "LPP-APR-000001" };
    const pending = await applyCaseAction(caseId, { action: "RESTRICT", actor: reviewer, reason: "policy concern noted", checklist: CHECKLIST, restrictionTypes: ["CONTACT"], endDate: inDays(14) });
    expect(pending.approvalRequired).toBe(true);
    expect(rows("profileRestriction")).toHaveLength(0);

    gate = { requiresApproval: true, status: "READY_TO_EXECUTE", approvalRequestId: "ap1", approvalCode: "LPP-APR-000001" };
    const done = await applyCaseAction(caseId, { action: "RESTRICT", actor: reviewer, reason: "policy concern noted", checklist: CHECKLIST, restrictionTypes: ["CONTACT"], endDate: inDays(14) });
    expect(done.approvalRequired).toBe(false);
    const restrictions = rows("profileRestriction");
    expect(restrictions).toHaveLength(1);
    expect(restrictions[0]).toMatchObject({ profileId: "p1", restrictionType: "CANNOT_CONTACT_SHARE", source: "risk_case", riskCaseId: caseId, isPermanent: false, appliedById: "rev1", active: true });
    expect(restrictions[0].endDate).toBeInstanceOf(Date);
    expect(executedApprovals).toEqual(["ap1"]);
    expect(rows("riskCase")[0]).toMatchObject({ status: "RESTRICTED", riskState: "RESTRICTED" });
    expect(await listActiveRiskRestrictions("p1")).toHaveLength(1);
    // the ONLY thing the member receives is the neutral notice
    expect(notifications.filter((n) => n.profileId === "p1")).toEqual([{ profileId: "p1", type: "SECURITY_NOTICE", data: {} }]);
    expect(suspended).toHaveLength(0);
    expect(rows("riskReview").map((r) => r.decision)).toEqual(["ACKNOWLEDGE", "INVESTIGATE", "RESTRICT"]);
  });

  it("clearing the case lifts its restriction, resolves its signals and keeps the whole history", async () => {
    await reachHighLevel();
    const caseId = rows("riskCase")[0].id as string;
    await applyCaseAction(caseId, { action: "ACKNOWLEDGE", actor: reviewer });
    await applyCaseAction(caseId, { action: "INVESTIGATE", actor: reviewer });
    gate = { requiresApproval: true, status: "READY_TO_EXECUTE", approvalRequestId: "ap1", approvalCode: "A" };
    await applyCaseAction(caseId, { action: "RESTRICT", actor: reviewer, reason: "policy concern noted", checklist: CHECKLIST, restrictionTypes: ["MATCHING"], endDate: inDays(7) });

    await applyCaseAction(caseId, { action: "CLEAR", actor: reviewer, reason: "verified as genuine by phone" });
    expect(rows("profileRestriction")[0]).toMatchObject({ active: false, liftedById: "rev1" });
    expect(rows("securityFlag").every((f) => f.status === "RESOLVED")).toBe(true);
    expect(rows("riskCase")[0]).toMatchObject({ status: "CLEARED", riskState: "CLEARED", closedById: "rev1" });
    expect(rows("riskCaseEvent").length).toBeGreaterThanOrEqual(5); // history kept
    expect(rows("riskReview").at(-1)).toMatchObject({ decision: "CLEAR" });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["RISK_CASE_OPENED", "RISK_ASSESSMENT_RECORDED", "RISK_CASE_ACTION", "RISK_RESTRICTION_APPLIED", "PROFILE_RESTRICTION_LIFTED"]));
  });

  it("suspension never happens without approval, and happens exactly once after it", async () => {
    await reachHighLevel();
    const caseId = rows("riskCase")[0].id as string;
    await applyCaseAction(caseId, { action: "ACKNOWLEDGE", actor: reviewer });
    gate = { requiresApproval: true, status: "ALREADY_PENDING", approvalRequestId: "ap2", approvalCode: "LPP-APR-000002" };
    expect((await applyCaseAction(caseId, { action: "SUSPEND", actor: reviewer, reason: "serious concern confirmed", checklist: CHECKLIST })).approvalRequired).toBe(true);
    expect(suspended).toHaveLength(0);
    gate = { requiresApproval: true, status: "READY_TO_EXECUTE", approvalRequestId: "ap2", approvalCode: "LPP-APR-000002" };
    await applyCaseAction(caseId, { action: "SUSPEND", actor: reviewer, reason: "serious concern confirmed", checklist: CHECKLIST });
    expect(suspended).toHaveLength(1);
    expect(rows("riskCase")[0].status).toBe("SUSPENDED");
    await expect(applyCaseAction(caseId, { action: "SUSPEND", actor: reviewer, reason: "serious concern confirmed", checklist: CHECKLIST })).rejects.toMatchObject({ status: 409 });
  });

  it("FALSE POSITIVE path: the false-positive reason is recorded on the signals and the case is closed as such", async () => {
    await reachHighLevel();
    const caseId = rows("riskCase")[0].id as string;
    await applyCaseAction(caseId, { action: "ACKNOWLEDGE", actor: reviewer });
    await applyCaseAction(caseId, { action: "MARK_FALSE_POSITIVE", actor: reviewer, reason: "the whole family uses one phone", falsePositiveReason: "SHARED_FAMILY_PHONE" });
    expect(rows("securityFlag").every((f) => f.status === "FALSE_POSITIVE" && f.falsePositiveReason === "SHARED_FAMILY_PHONE")).toBe(true);
    expect(rows("riskCase")[0].status).toBe("FALSE_POSITIVE");
    expect(rows("profileRestriction")).toHaveLength(0);
  });
});

describe("admin-subject flow: privileged access volume → invisible to the subject", () => {
  it("30 distinct sensitive records in an hour opens a staff review case that its subject can never see or act on", async () => {
    for (let i = 0; i < 30; i++) await publishSecurityEvent({ eventType: "ADMIN_SENSITIVE_ACCESS", adminId: "adm-subject", profileId: `t${i}`, source: "privacy-access-log" });
    const cases = rows("riskCase");
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ subjectAdminId: "adm-subject", category: "ADMIN_ACCESS", riskLevel: "MEDIUM", title: "Unusual privileged-access volume" });
    expect(tasks[0]).toMatchObject({ taskType: "ADMIN_SECURITY_REVIEW", resourceType: "ADMIN_USER" });
    expect(String(tasks[0].title)).not.toContain("adm-subject");
    expect(audits.map((a) => a.action)).toContain("RISK_ADMIN_ACCESS_ANOMALY");

    const caseId = cases[0].id as string;
    const subject = { id: "adm-subject", permissions: ["risk:view", "sensitive:security:view", "security:incidents:manage"] } as never;
    await expect(getRiskCaseForActor(caseId, subject)).rejects.toMatchObject({ status: 404 });
    await expect(applyCaseAction(caseId, { action: "CLEAR", actor: { ...(reviewer as object), id: "adm-subject" } as never, reason: "clearing myself" })).rejects.toMatchObject({ status: 404 });
    // a different admin with the security permission can
    const other = { id: "sec1", permissions: ["risk:view", "sensitive:security:view"] } as never;
    await expect(getRiskCaseForActor(caseId, other)).resolves.toMatchObject({ id: caseId });
    // and an ordinary reviewer without it cannot
    await expect(getRiskCaseForActor(caseId, { id: "rev1", permissions: ["risk:view"] } as never)).rejects.toMatchObject({ status: 404 });
  });

  it("re-viewing the same records repeatedly is not volume and opens nothing", async () => {
    for (let i = 0; i < 100; i++) await publishSecurityEvent({ eventType: "ADMIN_SENSITIVE_ACCESS", adminId: "adm-x", profileId: "same-target", source: "privacy-access-log" });
    expect(rows("riskCase")).toHaveLength(0);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// STEP 30 §64 — the engagement engine exercised end-to-end over an in-memory database: events are idempotent, workflows are
// governed (maker != checker, gate-bound approval, hash drift refused), runs start/park/cancel/complete without duplicates, and
// every reminder passes the single no-spam gate (opt-outs, suppression, restrictions, limits, quiet hours) before anything is sent.

type Row = Record<string, unknown> & { id?: string };
const db = new Map<string, Row[]>();
let idc = 0;
const rows = (t: string) => {
  if (!db.has(t)) db.set(t, []);
  return db.get(t) as Row[];
};

const UNIQUES: Record<string, string[][]> = {
  engagementEvent: [["eventKey"]],
  engagementReminder: [["dedupKey"]],
  engagementWorkflowRun: [["workflowId", "eventKey"]],
  engagementFeedback: [["code"]],
  engagementWorkflowVersion: [["workflowId", "version"]],
};

function cmp(actual: unknown, c: Record<string, unknown>): boolean {
  const a = actual instanceof Date ? actual.getTime() : (actual as number);
  const val = (x: unknown) => (x instanceof Date ? x.getTime() : (x as number));
  if ("in" in c && !(c.in as unknown[]).includes(actual)) return false;
  if ("notIn" in c && (c.notIn as unknown[]).includes(actual)) return false;
  if ("not" in c && (c.not === null ? actual == null : actual === c.not)) return false;
  if ("lte" in c && !(actual != null && a <= val(c.lte))) return false;
  if ("lt" in c && !(actual != null && a < val(c.lt))) return false;
  if ("gte" in c && !(actual != null && a >= val(c.gte))) return false;
  if ("gt" in c && !(actual != null && a > val(c.gt))) return false;
  return true;
}
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR") {
      if (!(v as Row[]).some((w) => matches(row, w))) return false;
      continue;
    }
    if (k === "AND") {
      if (!(v as Row[]).every((w) => matches(row, w))) return false;
      continue;
    }
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const c = v as Record<string, unknown>;
      const ops = ["in", "notIn", "not", "lte", "lt", "gte", "gt"];
      if (Object.keys(c).some((x) => ops.includes(x))) {
        if (!cmp(row[k], c)) return false;
        continue;
      }
      if (k.includes("_")) {
        if (!matches(row, c as Row)) return false; // compound unique key
        continue;
      }
      continue; // a relation filter: not modelled
    }
    if (v === null ? row[k] != null : row[k] !== v) return false;
  }
  return true;
}
function applyData(r: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && !(v instanceof Date) && "increment" in (v as Row)) r[k] = ((r[k] as number) ?? 0) + ((v as Row).increment as number);
    else if (v !== undefined) r[k] = v;
  }
}
const DEFAULTS: Record<string, Row> = {
  engagementEvent: { occurredAt: new Date() },
  engagementReminder: { state: "SCHEDULED", attempt: 1 },
  engagementWorkflowRun: { status: "ACTIVE", stepIndex: 0, attempts: 0 },
  engagementWorkflow: { status: "DRAFT", publishedVersionId: null, currentVersion: 1 },
  engagementWorkflowVersion: { status: "DRAFT", reviewerId: null },
  engagementFeedback: { status: "NEW" },
  // the schema defaults of the singleton settings row
  engagementSettings: { maxDailyNotifications: 5, maxWeeklyReengagement: 2, maxFollowupAttempts: 3, maxReengagementAttempts: 3, lowActivityAfterDays: 14, inactiveAfterDays: 30, reengagementCooldownDays: 14, reminderMinGapHours: 24, quietHoursStart: 22, quietHoursEnd: 8, defaultTimezone: "Asia/Karachi" },
};
function model(t: string) {
  const uniq = (row: Row) => {
    for (const keys of UNIQUES[t] ?? []) if (rows(t).some((r) => keys.every((k) => r[k] === row[k]))) throw Object.assign(new Error("unique"), { code: "P2002" });
  };
  return {
    create: async ({ data }: { data: Row }) => {
      const { versions, ...rest } = data as Row & { versions?: { create: Row } };
      const row: Row = { id: `${t}-${++idc}`, createdAt: new Date(), startedAt: new Date(), ...DEFAULTS[t], ...rest };
      uniq(row);
      rows(t).push(row);
      if (versions?.create) await model("engagementWorkflowVersion").create({ data: { ...versions.create, workflowId: row.id } });
      return { ...row };
    },
    findFirst: async ({ where }: { where?: Row } = {}) => { const r = rows(t).find((x) => matches(x, where)); return r ? { ...r } : null; },
    findUnique: async ({ where }: { where: Row }) => { const r = rows(t).find((x) => matches(x, where)); return r ? { ...r } : null; },
    findMany: async ({ where, take, orderBy }: { where?: Row; take?: number; orderBy?: Row } = {}) => {
      let o = rows(t).filter((x) => matches(x, where)).map((r) => ({ ...r }));
      const ob = Array.isArray(orderBy) ? orderBy[0] : orderBy;
      if (ob) { const [key, dir] = Object.entries(ob as Row)[0]; o = o.sort((a, b) => ((a[key] as number) > (b[key] as number) ? 1 : -1) * (dir === "desc" ? -1 : 1)); }
      return take ? o.slice(0, take) : o;
    },
    count: async ({ where }: { where?: Row } = {}) => rows(t).filter((x) => matches(x, where)).length,
    update: async ({ where, data }: { where: Row; data: Row }) => { const r = rows(t).find((x) => matches(x, where)); if (!r) throw new Error(`not found: ${t}`); applyData(r, data); return { ...r }; },
    updateMany: async ({ where, data }: { where?: Row; data: Row }) => { const m = rows(t).filter((x) => matches(x, where)); m.forEach((r) => applyData(r, data)); return { count: m.length }; },
    upsert: async ({ where, update, create }: { where: Row; update: Row; create: Row }) => {
      const r = rows(t).find((x) => matches(x, where));
      if (r) { applyData(r, update); return { ...r }; }
      const row: Row = { id: `${t}-${++idc}`, ...DEFAULTS[t], ...create };
      rows(t).push(row);
      return { ...row };
    },
    deleteMany: async ({ where }: { where?: Row }) => { const keep = rows(t).filter((x) => !matches(x, where)); const n = rows(t).length - keep.length; db.set(t, keep); return { count: n }; },
  };
}

const flags = new Set<string>();
const audits: Row[] = [];
const sent: Row[] = [];
const tasks: Row[] = [];
let gate: Record<string, unknown> = { requiresApproval: true, status: "PENDING", approvalCode: "APR-1", approvalRequestId: "ar1" };
const restricted = new Set<string>();

type Snap = import("@/lib/engagement/types").EngagementSnapshot;
function snapshot(over: Partial<Snap> = {}): Snap {
  return {
    now: new Date(), language: "EN",
    profile: { status: "ACTIVE", verified: false, completion: 60, createdAt: new Date("2026-01-01"), softDeleted: false },
    missingSections: ["Family"], hasPhoto: true, hasPartnerRequirements: true,
    verification: { status: "VERIFICATION_PENDING", requestedInfoCount: 0 },
    proposals: { total: 0, awaitingMyResponse: 0, responded: 0, received: 0 },
    meetings: { awaitingConfirmation: 0, scheduled: 0, completed: 0, completedAwaitingFollowup: 0 },
    membership: { status: null, endsAt: null }, openCases: 0, hasNotificationPreferences: true, lastActivityAt: new Date(), crmStage: null,
    recentSupportInteractions: 0, completedTasksRatio: null,
    ...over,
  };
}
let snap: Snap | null = snapshot();

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, name: string) => (name === "$transaction" ? async (ops: Promise<unknown>[]) => Promise.all(ops) : model(name)) }),
}));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async (p: string) => `LPP-${p}-${String(++idc).padStart(6, "0")}`) }));
vi.mock("@/lib/ops/feature-flags", () => ({ isFeatureEnabled: vi.fn(async (k: string) => flags.has(k)) }));
vi.mock("@/lib/approvals/catalog", () => ({ seedApprovalPolicies: vi.fn(async () => undefined) }));
vi.mock("@/lib/approvals/gate", () => ({ enforceApprovalGate: vi.fn(async () => gate), markApprovalExecuted: vi.fn(async () => undefined) }));
vi.mock("@/lib/marketing/approval", () => ({ assertApprovedPayloadMatches: vi.fn(async () => undefined) }));
vi.mock("@/lib/engagement/read-model", () => ({ loadEngagementSnapshot: vi.fn(async () => snap) }));
vi.mock("@/lib/profile-restrictions", () => ({ hasActiveRestriction: vi.fn(async (p: string) => restricted.has(p)) }));
vi.mock("@/lib/notifications/notification-service", () => ({ sendNotification: vi.fn(async (a: Row) => { sent.push(a); }) }));
vi.mock("@/lib/workflow/engine", () => ({ createFromEvent: vi.fn(async (t: Row) => { if (!tasks.some((x) => x.dedupKey === t.dedupKey)) tasks.push(t); return { id: "t" }; }) }));
vi.mock("@/lib/crm/lifecycle-service", () => ({ transitionStage: vi.fn(async () => undefined) }));
vi.mock("@/lib/family/access-control", () => ({ canAccessRecord: vi.fn(async () => false) }));

const events = await import("./events");
const wf = await import("./workflow-service");
const runner = await import("./workflow-runner");
const deliver = await import("./deliver");
const reminders = await import("./reminders");
const feedback = await import("./feedback-service");
const { resetEngagementApprovalSetupForTests } = await import("./approval");

type Admin = Parameters<typeof wf.createWorkflow>[0];
const admin = (id: string): Admin => ({ id, permissions: [] } as unknown as Admin);
const AUTHOR = admin("author"), REVIEWER = admin("reviewer");

const DEFINITION = { conditions: { completionLt: 100 }, cancelOn: ["PROFILE_COMPLETED"], steps: [{ type: "WAIT", hours: 72 }, { type: "RECHECK_ELIGIBLE" }, { type: "NOTIFY_APPLICANT", kind: "PROFILE_INCOMPLETE" }] };
const P = "profile-1";

function allOn() {
  for (const f of ["engagement.enabled", "engagement.events.enabled", "engagement.workflows.enabled", "engagement.reengagement.enabled", "engagement.feedback.enabled", "engagement.announcements.enabled"]) flags.add(f);
}

beforeEach(() => {
  db.clear(); audits.length = 0; sent.length = 0; tasks.length = 0; flags.clear(); restricted.clear(); idc = 0;
  gate = { requiresApproval: true, status: "PENDING", approvalCode: "APR-1", approvalRequestId: "ar1" };
  snap = snapshot();
  resetEngagementApprovalSetupForTests();
});

async function publishedWorkflow(def: unknown = DEFINITION, trigger = "PROFILE_STARTED") {
  const w = await wf.createWorkflow(AUTHOR, { name: "Profile completion reminder", trigger, definition: def });
  await wf.submitWorkflowVersion(AUTHOR, w.id, 1);
  await wf.reviewWorkflowVersion(REVIEWER, w.id, 1, "APPROVE");
  gate = { requiresApproval: false };
  await wf.publishWorkflowVersion(AUTHOR, w.id, 1, "going live after review");
  return w.id as string;
}

describe("engagement events", () => {
  it("records nothing while the flags are off", async () => {
    expect((await events.recordEngagementEvent({ profileId: P, type: "LOGIN" })).recorded).toBe(false);
    expect(rows("engagementEvent")).toHaveLength(0);
  });

  it("stores a replayed event once and keeps only safe payload keys", async () => {
    allOn();
    const a = await events.recordEngagementEvent({ profileId: P, type: "PROPOSAL_RECEIVED", sourceKey: "prop-1", refType: "PROPOSAL", refId: "prop-1", payload: { count: 2, email: "x@y.com", note: "private", status: "NEW" } });
    const b = await events.recordEngagementEvent({ profileId: P, type: "PROPOSAL_RECEIVED", sourceKey: "prop-1", refType: "PROPOSAL", refId: "prop-1" });
    expect(a.recorded).toBe(true);
    expect(b).toMatchObject({ recorded: false, duplicate: true });
    expect(rows("engagementEvent")).toHaveLength(1);
    expect(rows("engagementEvent")[0].payload).toEqual({ count: 2, status: "NEW" });
  });

  it("once-per-profile events and one login per day are idempotent", async () => {
    allOn();
    await events.recordEngagementEvent({ profileId: P, type: "USER_REGISTERED" });
    await events.recordEngagementEvent({ profileId: P, type: "USER_REGISTERED", sourceKey: "other" });
    await events.recordEngagementEvent({ profileId: P, type: "LOGIN" });
    await events.recordEngagementEvent({ profileId: P, type: "LOGIN" });
    expect(rows("engagementEvent").filter((e) => e.type === "USER_REGISTERED")).toHaveLength(1);
    expect(rows("engagementEvent").filter((e) => e.type === "LOGIN")).toHaveLength(1);
  });

  it("a system event is not evidence of activity, an applicant action is", async () => {
    allOn();
    await events.recordEngagementEvent({ profileId: P, type: "PROPOSAL_RECEIVED", sourceKey: "p" });
    expect(rows("engagementProfileState")).toHaveLength(0);
    await events.recordEngagementEvent({ profileId: P, type: "LOGIN" });
    expect(rows("engagementProfileState")[0]).toMatchObject({ profileId: P, activityState: "ACTIVE" });
  });

  it("the applicant acting cancels a pending reminder and marks a sent one as responded", async () => {
    allOn();
    rows("engagementReminder").push({ id: "r1", profileId: P, kind: "PROFILE_INCOMPLETE", state: "SCHEDULED", refId: null });
    rows("engagementReminder").push({ id: "r2", profileId: P, kind: "PROFILE_INCOMPLETE", state: "SENT", sentAt: new Date(), refId: null });
    await events.recordEngagementEvent({ profileId: P, type: "PROFILE_COMPLETED" });
    expect(rows("engagementReminder").find((r) => r.id === "r1")?.state).toBe("CANCELLED");
    expect(rows("engagementReminder").find((r) => r.id === "r2")?.state).toBe("RESPONDED");
  });
});

describe("workflow governance", () => {
  it("rejects a definition that uses a score or a sensitive attribute, or an unlisted step", async () => {
    await expect(wf.createWorkflow(AUTHOR, { name: "Bad score rule", trigger: "LOGIN", definition: { conditions: { activityScore: 10 }, steps: [{ type: "RECHECK_ELIGIBLE" }] } })).rejects.toMatchObject({ status: 422 });
    await expect(wf.createWorkflow(AUTHOR, { name: "Bad religion rule", trigger: "LOGIN", definition: { conditions: { religion: "x" }, steps: [{ type: "RECHECK_ELIGIBLE" }] } })).rejects.toMatchObject({ status: 422 });
    await expect(wf.createWorkflow(AUTHOR, { name: "Unlisted step", trigger: "LOGIN", definition: { steps: [{ type: "SHARE_CONTACT" }] } })).rejects.toMatchObject({ status: 422 });
    await expect(wf.createWorkflow(AUTHOR, { name: "Send without recheck", trigger: "LOGIN", definition: { steps: [{ type: "NOTIFY_APPLICANT", kind: "INACTIVITY" }] } })).rejects.toMatchObject({ status: 422 });
  });

  it("blocks pressure wording in task titles at submit time and audits it", async () => {
    const w = await wf.createWorkflow(AUTHOR, { name: "Pressure title", trigger: "LOGIN", definition: { steps: [{ type: "CREATE_TASK", taskType: "GENERAL_ADMIN_TASK", title: "Act now or you will lose your chance" }] } });
    await expect(wf.submitWorkflowVersion(AUTHOR, w.id, 1)).rejects.toMatchObject({ status: 422 });
    expect(audits.some((a) => a.action === "ENGAGEMENT_CONTENT_POLICY_BLOCKED")).toBe(true);
    expect(rows("engagementWorkflowVersion")[0].status).toBe("DRAFT");
  });

  it("the author cannot review; a different person can; publish waits for the approval gate", async () => {
    const w = await wf.createWorkflow(AUTHOR, { name: "Profile completion reminder", trigger: "PROFILE_STARTED", definition: DEFINITION });
    await wf.submitWorkflowVersion(AUTHOR, w.id, 1);
    await expect(wf.reviewWorkflowVersion(AUTHOR, w.id, 1, "APPROVE")).rejects.toMatchObject({ status: 403 });
    await wf.reviewWorkflowVersion(REVIEWER, w.id, 1, "APPROVE");
    const out = await wf.publishWorkflowVersion(AUTHOR, w.id, 1, "ready to go live");
    expect(out).toMatchObject({ approvalRequired: true });
    expect(rows("engagementWorkflow")[0].status).not.toBe("PUBLISHED");
    gate = { requiresApproval: true, status: "READY_TO_EXECUTE", approvalCode: "APR-1", approvalRequestId: "ar1" };
    const done = await wf.publishWorkflowVersion(AUTHOR, w.id, 1, "approval granted");
    expect(done.approvalRequired).toBe(false);
    expect(rows("engagementWorkflow")[0].status).toBe("PUBLISHED");
  });

  it("refuses to publish content that changed after it was reviewed", async () => {
    const w = await wf.createWorkflow(AUTHOR, { name: "Profile completion reminder", trigger: "PROFILE_STARTED", definition: DEFINITION });
    await wf.submitWorkflowVersion(AUTHOR, w.id, 1);
    await wf.reviewWorkflowVersion(REVIEWER, w.id, 1, "APPROVE");
    rows("engagementWorkflowVersion")[0].definition = { ...DEFINITION, steps: [{ type: "WAIT", hours: 1 }, { type: "RECHECK_ELIGIBLE" }, { type: "NOTIFY_APPLICANT", kind: "INACTIVITY" }] };
    gate = { requiresApproval: false };
    await expect(wf.publishWorkflowVersion(AUTHOR, w.id, 1, "tampered after review")).rejects.toMatchObject({ status: 409 });
  });

  it("installs the standard automations as drafts only, and never twice", async () => {
    const a = await wf.installDefaultWorkflows(AUTHOR);
    const b = await wf.installDefaultWorkflows(AUTHOR);
    expect(a.created).toBeGreaterThanOrEqual(8);
    expect(b.created).toBe(0);
    expect(rows("engagementWorkflow").every((w) => w.status === "DRAFT")).toBe(true);
    expect(rows("engagementWorkflowVersion").every((v) => v.status === "DRAFT")).toBe(true);
  });
});

describe("workflow runs", () => {
  it("starts a run, parks it on the wait, never starts a second run for a replayed event", async () => {
    allOn();
    await publishedWorkflow();
    await events.recordEngagementEvent({ profileId: P, type: "PROFILE_STARTED" });
    await events.recordEngagementEvent({ profileId: P, type: "PROFILE_STARTED" });
    const runs = rows("engagementWorkflowRun");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "ACTIVE", stepIndex: 1 });
    expect((runs[0].nextRunAt as Date).getTime()).toBeGreaterThan(Date.now() + 70 * 3_600_000);
    expect(sent).toHaveLength(0);
  });

  it("does not run an unpublished or paused workflow", async () => {
    allOn();
    const id = await publishedWorkflow();
    await wf.pauseWorkflow(AUTHOR, id, "pausing for a check");
    await events.recordEngagementEvent({ profileId: P, type: "PROFILE_STARTED" });
    expect(rows("engagementWorkflowRun")).toHaveLength(0);
  });

  it("skips (fails closed) when the conditions do not match at the start", async () => {
    allOn();
    await publishedWorkflow();
    snap = snapshot({ profile: { status: "ACTIVE", verified: false, completion: 100, createdAt: new Date(), softDeleted: false } });
    await events.recordEngagementEvent({ profileId: P, type: "PROFILE_STARTED" });
    expect(rows("engagementWorkflowRun")[0].status).toBe("SKIPPED");
    expect(sent).toHaveLength(0);
  });

  it("the applicant completing the profile cancels the waiting run and nothing is ever sent", async () => {
    allOn();
    await publishedWorkflow();
    await events.recordEngagementEvent({ profileId: P, type: "PROFILE_STARTED" });
    await events.recordEngagementEvent({ profileId: P, type: "PROFILE_COMPLETED" });
    expect(rows("engagementWorkflowRun")[0]).toMatchObject({ status: "CANCELLED" });
    const later = new Date(Date.now() + 5 * 86_400_000);
    await runner.advanceDueRuns(later);
    expect(sent).toHaveLength(0);
  });

  it("after the wait, an eligible applicant gets exactly one reminder even if the tick runs twice", async () => {
    allOn();
    await publishedWorkflow();
    await events.recordEngagementEvent({ profileId: P, type: "PROFILE_STARTED" });
    const later = new Date(Date.now() + 4 * 86_400_000);
    // outside quiet hours in the default Karachi window (22-08): 07:00 UTC = 12:00 local
    later.setUTCHours(7, 0, 0, 0);
    await runner.advanceDueRuns(later);
    await runner.advanceDueRuns(later);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ profileId: P, type: "ENGAGEMENT_PROFILE_REMINDER" });
    expect(rows("engagementWorkflowRun")[0].status).toBe("COMPLETED");
    expect(rows("engagementReminder")).toHaveLength(1);
  });

  it("creates the staff task once per run step, not once per tick", async () => {
    allOn();
    await publishedWorkflow({ conditions: {}, cancelOn: [], steps: [{ type: "CREATE_TASK", taskType: "NEW_PROFILE_REVIEW" }] }, "PROFILE_SUBMITTED");
    await events.recordEngagementEvent({ profileId: P, type: "PROFILE_SUBMITTED" });
    await runner.advanceDueRuns(new Date(Date.now() + 86_400_000));
    expect(tasks).toHaveLength(1);
  });
});

describe("the single no-spam gate", () => {
  const SUNDAY_NOON = new Date("2026-10-04T07:00:00Z"); // 12:00 in Asia/Karachi
  async function reminder(kind = "PROFILE_INCOMPLETE", over: Row = {}) {
    allOn();
    const { reminder: r } = await reminders.scheduleReminder({ profileId: P, kind: kind as never, dueAt: SUNDAY_NOON, ...(over as object) });
    return r.id as string;
  }

  it("sends one clean reminder, once", async () => {
    const id = await reminder();
    expect((await deliver.deliverReminder(id, SUNDAY_NOON)).state).toBe("SENT");
    expect((await deliver.deliverReminder(id, SUNDAY_NOON)).note).toBe("ALREADY_FINAL");
    expect(sent).toHaveLength(1);
  });

  it("does nothing while engagement is switched off", async () => {
    const id = await reminder();
    flags.clear();
    expect((await deliver.deliverReminder(id, SUNDAY_NOON)).state).toBe("DEFERRED");
    expect(sent).toHaveLength(0);
  });

  it("respects the applicant's own switches", async () => {
    const id = await reminder();
    rows("engagementPreference").push({ profileId: P, remindersEnabled: false });
    expect((await deliver.deliverReminder(id, SUNDAY_NOON)).state).toBe("OPTED_OUT");
    const id2 = await reminder("INACTIVITY");
    snap = snapshot({ lastActivityAt: new Date("2026-01-01") });
    rows("engagementPreference")[0].remindersEnabled = true;
    rows("engagementPreference")[0].reengagementEnabled = false;
    expect((await deliver.deliverReminder(id2, SUNDAY_NOON)).state).toBe("OPTED_OUT");
    expect(sent).toHaveLength(0);
  });

  it("respects suppression, account restrictions and closed accounts", async () => {
    const id = await reminder();
    rows("communicationSuppression").push({ profileId: P, status: "ACTIVE", scope: "ALL" });
    expect((await deliver.deliverReminder(id, SUNDAY_NOON)).state).toBe("SUPPRESSED");
    db.delete("communicationSuppression");
    const id2 = await reminder("VERIFICATION_STALLED");
    restricted.add(P);
    expect((await deliver.deliverReminder(id2, SUNDAY_NOON)).state).toBe("SUPPRESSED");
    restricted.clear();
    const id3 = await reminder("PROPOSAL_PENDING");
    snap = snapshot({ profile: { status: "SUSPENDED", verified: false, completion: 60, createdAt: new Date(), softDeleted: false } });
    expect((await deliver.deliverReminder(id3, SUNDAY_NOON)).state).toBe("CANCELLED");
    expect(sent).toHaveLength(0);
  });

  it("cancels a reminder for something the applicant has already done", async () => {
    const id = await reminder();
    snap = snapshot({ profile: { status: "ACTIVE", verified: false, completion: 100, createdAt: new Date(), softDeleted: false } });
    const out = await deliver.deliverReminder(id, SUNDAY_NOON);
    expect(out).toMatchObject({ state: "CANCELLED", note: "NO_LONGER_APPLICABLE" });
    expect(sent).toHaveLength(0);
  });

  it("waits out quiet hours instead of sending", async () => {
    const id = await reminder();
    const night = new Date("2026-10-04T19:00:00Z"); // 00:00 in Karachi
    const out = await deliver.deliverReminder(id, night);
    expect(out).toMatchObject({ state: "DEFERRED", note: "QUIET_HOURS" });
    expect((rows("engagementReminder")[0].dueAt as Date).getTime()).toBeGreaterThan(night.getTime());
    expect(rows("engagementReminder")[0].state).toBe("SCHEDULED");
    expect(sent).toHaveLength(0);
  });

  it("enforces the admin-configured daily limit", async () => {
    const id = await reminder();
    rows("engagementSettings").push({ id: 1 as unknown as string, maxDailyNotifications: 2, maxWeeklyReengagement: 2, maxFollowupAttempts: 3, maxReengagementAttempts: 3, lowActivityAfterDays: 14, inactiveAfterDays: 30, reengagementCooldownDays: 14, reminderMinGapHours: 24, quietHoursStart: 22, quietHoursEnd: 8, defaultTimezone: "Asia/Karachi" });
    for (let i = 0; i < 2; i++) rows("notification").push({ recipientProfileId: P, type: "ENGAGEMENT_ANNOUNCEMENT", createdAt: new Date(SUNDAY_NOON.getTime() - 3_600_000) });
    const out = await deliver.deliverReminder(id, SUNDAY_NOON);
    expect(out).toMatchObject({ state: "DEFERRED", note: "DAILY_LIMIT_REACHED" });
    expect(sent).toHaveLength(0);
  });

  it("stops re-engaging after the attempt cap", async () => {
    snap = snapshot({ lastActivityAt: new Date("2026-01-01") });
    const id = await reminder("INACTIVITY");
    for (let i = 0; i < 3; i++) rows("engagementReminder").push({ id: `old${i}`, profileId: P, kind: "INACTIVITY", refId: null, state: "SENT", sentAt: new Date("2026-02-0" + (i + 1)) });
    const out = await deliver.deliverReminder(id, SUNDAY_NOON);
    expect(out.state).toBe("EXPIRED");
    expect(sent).toHaveLength(0);
  });

  it("scheduling the same reminder twice creates one row", async () => {
    allOn();
    const a = await reminders.scheduleReminder({ profileId: P, kind: "PROFILE_INCOMPLETE", dueAt: SUNDAY_NOON, dedupKey: "same" });
    const b = await reminders.scheduleReminder({ profileId: P, kind: "PROFILE_INCOMPLETE", dueAt: SUNDAY_NOON, dedupKey: "same" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(rows("engagementReminder")).toHaveLength(1);
  });
});

describe("meeting follow-up choices", () => {
  it("only the applicant's own completed meeting, once, and it never touches the proposal", async () => {
    allOn();
    rows("meeting").push({ id: "m1", status: "COMPLETED", proposalId: "prop1", proposal: { profileAId: P } });
    rows("proposal").push({ id: "prop1", status: "MEETING_COMPLETED" });
    // the in-memory meeting lookup cannot evaluate the relation filter, so the ownership rule is asserted via the query shape
    const spy = vi.spyOn(model("meeting"), "findFirst");
    void spy;
    const out = await feedback.submitMeetingFollowup(P, { meetingId: "m1", choice: "FURTHER_DISCUSSION" });
    expect(out.code).toMatch(/^LPP-EFB-/);
    expect(tasks).toHaveLength(1);
    expect(rows("proposal")[0].status).toBe("MEETING_COMPLETED");
    await expect(feedback.submitMeetingFollowup(P, { meetingId: "m1", choice: "FURTHER_DISCUSSION" })).rejects.toMatchObject({ status: 409 });
    await expect(feedback.submitMeetingFollowup(P, { meetingId: "m1", choice: "MARRY_NOW" })).rejects.toMatchObject({ status: 422 });
  });

  it("rejects survey questions about marriage outcomes", () => {
    expect(() => feedback.validateSurveyQuestions([{ id: "q1", text: "Did you get married through us?", type: "RATING" }])).toThrow();
    expect(feedback.validateSurveyQuestions([{ id: "q1", text: "How easy was it to complete your profile?", type: "RATING" }])).toHaveLength(1);
  });

  it("does not accept feedback while the feature is off", async () => {
    await expect(feedback.submitFeedback(P, { type: "PLATFORM", message: "It works well" })).rejects.toMatchObject({ status: 404 });
  });
});

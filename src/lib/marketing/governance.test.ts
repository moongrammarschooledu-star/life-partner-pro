import { beforeEach, describe, expect, it, vi } from "vitest";

// STEP 29 §29/§30/§50 — launch governance, maker-checker separation, budget control and the privilege boundaries around
// them, exercised against the REAL campaign and budget services over an in-memory database. The STEP 19 gate is a
// controllable fake so each outcome (pending approval, approved, drifted payload, gate absent) can be driven.

type Row = Record<string, unknown> & { id?: string };
const db = new Map<string, Row[]>();
let idc = 0;
const rows = (t: string) => {
  if (!db.has(t)) db.set(t, []);
  return db.get(t) as Row[];
};

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    const actual = row[k];
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const c = v as Record<string, unknown>;
      if ("in" in c && !(c.in as unknown[]).includes(actual)) return false;
      if ("not" in c && (c.not === null ? actual == null : actual === c.not)) return false;
      if ("lte" in c && !((actual as Date) <= (c.lte as Date))) return false;
      continue;
    }
    if (v === null ? actual != null : actual !== v) return false;
  }
  return true;
}
const DEFAULTS: Record<string, Row> = { marketingCampaign: { status: "DRAFT", spendVerified: false, spendVerifiedMinor: 0, submittedById: null, approvedById: null, contentHash: null } };
function model(t: string) {
  return {
    create: async ({ data }: { data: Row }) => {
      const row: Row = { id: `${t}-${++idc}`, createdAt: new Date(), ...DEFAULTS[t], ...data };
      rows(t).push(row);
      return { ...row };
    },
    createMany: async ({ data }: { data: Row[] }) => { for (const d of data) rows(t).push({ id: `${t}-${++idc}`, ...d }); return { count: data.length }; },
    findFirst: async ({ where }: { where?: Row } = {}) => { const r = rows(t).find((x) => matches(x, where)); return r ? { ...r } : null; },
    findUnique: async ({ where }: { where: Row }) => { const r = rows(t).find((x) => matches(x, where)); return r ? { ...r } : null; },
    findMany: async ({ where, take }: { where?: Row; take?: number } = {}) => { const o = rows(t).filter((x) => matches(x, where)).map((r) => ({ ...r })); return take ? o.slice(0, take) : o; },
    count: async ({ where }: { where?: Row } = {}) => rows(t).filter((x) => matches(x, where)).length,
    update: async ({ where, data }: { where: Row; data: Row }) => { const r = rows(t).find((x) => matches(x, where)); if (!r) throw new Error(`not found: ${t}`); Object.assign(r, data); return { ...r }; },
  };
}

const audits: Row[] = [];
const flags = new Set<string>();
let gate: Record<string, unknown> = { requiresApproval: true, status: "PENDING", approvalCode: "APR-1", approvalRequestId: "ar1" };
const executed: string[] = [];
const providerCalls: string[] = [];

vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_t, name: string) => model(name) }) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async (p: string) => `LPP-${p}-${String(++idc).padStart(6, "0")}`) }));
vi.mock("@/lib/ops/feature-flags", () => ({ isFeatureEnabled: vi.fn(async (k: string) => flags.has(k)) }));
vi.mock("@/lib/approvals/catalog", () => ({ seedApprovalPolicies: vi.fn(async () => undefined) }));
vi.mock("@/lib/approvals/gate", () => ({
  enforceApprovalGate: vi.fn(async () => gate),
  markApprovalExecuted: vi.fn(async (id: string) => { executed.push(id); }),
}));
vi.mock("@/lib/marketing/providers/registry", () => ({
  getMarketingAdapter: vi.fn(() => ({
    sandbox: true,
    createCampaign: async () => { providerCalls.push("create"); return { externalId: "ext1", status: "PAUSED" }; },
    resumeCampaign: async () => { providerCalls.push("resume"); return { externalId: "ext1", status: "ACTIVE" }; },
    pauseCampaign: async () => { providerCalls.push("pause"); return { externalId: "ext1", status: "PAUSED" }; },
    updateCampaign: async () => { providerCalls.push("update"); return { externalId: "ext1", status: "ACTIVE" }; },
  })),
}));

vi.stubEnv("NEXTAUTH_SECRET", "governance-test-secret-0123456789abcdef01");

const svc = await import("./campaign-service");
const { changeCampaignBudget, recordVerifiedSpend } = await import("./budget-service");
const { resetMarketingApprovalSetupForTests } = await import("./approval");

type Admin = Parameters<typeof svc.createCampaign>[0];
const admin = (id: string): Admin => ({ id, permissions: [] } as unknown as Admin);
const AUTHOR = admin("author"), REVIEWER = admin("reviewer"), OTHER = admin("other");
const campaigns = () => rows("marketingCampaign");
const status = (id: string) => campaigns().find((c) => c.id === id)?.status;

async function draft(over: Record<string, unknown> = {}) {
  const c = await svc.createCampaign(AUTHOR, { name: "Spring inquiry drive", campaignKey: "spring-2026", objective: "AWARENESS", budgetTotalMinor: 1_000_000, budgetDailyMinor: 50_000, landingPageId: null, formId: null, ...over } as never);
  return c.id as string;
}
async function approved(over: Record<string, unknown> = {}) {
  const id = await draft(over);
  await svc.submitCampaignForReview(AUTHOR, id);
  await svc.approveCampaign(REVIEWER, id);
  return id;
}

beforeEach(() => {
  db.clear(); audits.length = 0; flags.clear(); executed.length = 0; providerCalls.length = 0; idc = 0;
  flags.add("marketing.enabled");
  gate = { requiresApproval: true, status: "PENDING", approvalCode: "APR-1", approvalRequestId: "ar1" };
  resetMarketingApprovalSetupForTests();
});

describe("campaign review separation of duties", () => {
  it("a draft needs a budget and clean content before it can be submitted", async () => {
    const empty = await draft({ campaignKey: "no-budget", budgetTotalMinor: 0, budgetDailyMinor: null });
    await expect(svc.submitCampaignForReview(AUTHOR, empty)).rejects.toMatchObject({ status: 422 });
    const bad = await draft({ campaignKey: "bad-copy", description: "We guarantee you will find your perfect match" });
    await expect(svc.submitCampaignForReview(AUTHOR, bad)).rejects.toMatchObject({ status: 422 });
    expect(status(bad)).toBe("DRAFT");
    expect(audits.some((a) => a.action === "MARKETING_CONTENT_POLICY_BLOCKED")).toBe(true);
  });

  it("neither the author nor the submitter can approve or reject; a third person can", async () => {
    const id = await draft();
    await svc.submitCampaignForReview(OTHER, id); // submitted by someone other than the author
    await expect(svc.approveCampaign(AUTHOR, id)).rejects.toMatchObject({ status: 403 });
    await expect(svc.approveCampaign(OTHER, id)).rejects.toMatchObject({ status: 403 });
    await expect(svc.rejectCampaign(AUTHOR, id, "no thanks please")).rejects.toMatchObject({ status: 403 });
    expect(status(id)).toBe("IN_REVIEW");
    await svc.approveCampaign(REVIEWER, id);
    expect(status(id)).toBe("APPROVED");
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["MARKETING_CAMPAIGN_SUBMITTED", "MARKETING_CAMPAIGN_APPROVED"]));
  });

  it("content that changes between submission and approval cannot be approved", async () => {
    const id = await draft();
    await svc.submitCampaignForReview(AUTHOR, id);
    campaigns()[0].objective = "EVENT_PROMOTION"; // changed behind the review's back (a material field)
    await expect(svc.approveCampaign(REVIEWER, id)).rejects.toMatchObject({ status: 409 });
    expect(status(id)).toBe("IN_REVIEW");
  });

  it("a material edit after approval sends the campaign back to draft and clears the approval", async () => {
    const id = await approved();
    await svc.updateCampaign(AUTHOR, id, { name: "A different name" });
    expect(status(id)).toBe("DRAFT");
    expect(campaigns()[0]).toMatchObject({ approvedById: null, contentHash: null });
  });

  it("a review decision can only be made on a campaign that is in review", async () => {
    const id = await draft();
    await expect(svc.approveCampaign(REVIEWER, id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("launch governance — ACTIVE is reachable only through launchCampaign", () => {
  it("refuses to launch a campaign that has not been approved", async () => {
    const id = await draft();
    await expect(svc.launchCampaign(OTHER, id, "go live now")).rejects.toMatchObject({ status: 422 });
    expect(status(id)).toBe("DRAFT");
    expect(providerCalls).toEqual([]);
  });

  it("refuses when the master flag is off, however well approved", async () => {
    const id = await approved();
    flags.clear();
    await expect(svc.launchCampaign(OTHER, id, "go live now")).rejects.toMatchObject({ status: 422 });
    expect(status(id)).toBe("APPROVED");
  });

  it("holds the launch for the independent approval and reports it as pending — nothing goes live", async () => {
    const id = await approved();
    const out = await svc.launchCampaign(OTHER, id, "go live now");
    expect(out).toMatchObject({ approvalRequired: true, approvalCode: "APR-1" });
    expect(status(id)).toBe("APPROVED");
    expect(providerCalls).toEqual([]);
    expect(executed).toEqual([]);
  });

  it("launches once the approval is READY_TO_EXECUTE and the approved payload still matches", async () => {
    const id = await approved();
    const c = campaigns()[0];
    rows("approvalRequest").push({ id: "ar1", requestedPayload: { campaignId: id, contentHash: c.contentHash, budgetTotalMinor: c.budgetTotalMinor, landingVersionId: null, formVersionId: null } });
    gate = { requiresApproval: true, status: "READY_TO_EXECUTE", approvalCode: "APR-1", approvalRequestId: "ar1" };
    const out = await svc.launchCampaign(OTHER, id, "go live now");
    expect(out.approvalRequired).toBe(false);
    expect(status(id)).toBe("ACTIVE");
    expect(executed).toEqual(["ar1"]);
    expect(providerCalls).toEqual(["create", "resume"]);
    expect(audits.some((a) => a.action === "MARKETING_CAMPAIGN_LAUNCHED")).toBe(true);
  });

  it("refuses an approval whose payload no longer matches the campaign (TOCTOU)", async () => {
    const id = await approved();
    rows("approvalRequest").push({ id: "ar1", requestedPayload: { campaignId: id, contentHash: "stale-hash", budgetTotalMinor: 1_000_000, landingVersionId: null, formVersionId: null } });
    gate = { requiresApproval: true, status: "READY_TO_EXECUTE", approvalCode: "APR-1", approvalRequestId: "ar1" };
    await expect(svc.launchCampaign(OTHER, id, "go live now")).rejects.toMatchObject({ status: 409 });
    expect(status(id)).toBe("APPROVED");
    expect(executed).toEqual([]);
  });

  it("still needs an independent campaign-level approval when the approval POLICY has been removed (gate fails open)", async () => {
    const id = await draft();
    await svc.submitCampaignForReview(AUTHOR, id);
    campaigns()[0].status = "APPROVED"; campaigns()[0].approvedById = "author"; // self-approved by tampering
    gate = { requiresApproval: false };
    await expect(svc.launchCampaign(OTHER, id, "go live now")).rejects.toMatchObject({ status: 422 });
    expect(status(id)).toBe("APPROVED");
  });

  it("with the policy absent but a genuine independent approval, launch proceeds (the campaign-level check is the backstop, not a blocker)", async () => {
    const id = await approved();
    gate = { requiresApproval: false };
    expect((await svc.launchCampaign(OTHER, id, "go live now")).approvalRequired).toBe(false);
    expect(status(id)).toBe("ACTIVE");
  });

  it("a launched campaign's core settings cannot be edited", async () => {
    const id = await approved();
    gate = { requiresApproval: false };
    await svc.launchCampaign(OTHER, id, "go live now");
    await expect(svc.updateCampaign(AUTHOR, id, { name: "sneaky rename" })).rejects.toMatchObject({ status: 409 });
    await expect(svc.updateCampaign(AUTHOR, id, { targeting: { cities: ["Lahore"] } })).rejects.toMatchObject({ status: 409 });
  });

  it("a real provider that is not connected blocks the launch", async () => {
    const id = await approved({ providerKey: "META", campaignKey: "meta-drive" });
    flags.add("marketing.provider_sync.enabled");
    gate = { requiresApproval: false };
    await expect(svc.launchCampaign(OTHER, id, "go live now")).rejects.toMatchObject({ status: 422 });
    expect(status(id)).not.toBe("ACTIVE");
  });

  it("a linked landing page that is not published blocks the launch", async () => {
    rows("landingPage").push({ id: "lp1", status: "DRAFT", publishedVersionId: null });
    const id = await approved({ landingPageId: "lp1" });
    gate = { requiresApproval: false };
    await expect(svc.launchCampaign(OTHER, id, "go live now")).rejects.toMatchObject({ status: 422 });
  });

  it("an unapproved creative blocks the launch", async () => {
    const id = await draft();
    rows("marketingCreative").push({ id: "cr1", campaignId: id, status: "DRAFT", contentHash: "h", headline: "Talk to our team", body: "Learn how admin-assisted matchmaking works.", description: null, ctaLabel: "Learn more" });
    await svc.submitCampaignForReview(AUTHOR, id);
    await svc.approveCampaign(REVIEWER, id);
    gate = { requiresApproval: false };
    await expect(svc.launchCampaign(OTHER, id, "go live now")).rejects.toMatchObject({ status: 422 });
  });
});

describe("pause, resume and scheduled start", () => {
  async function active() {
    const id = await approved();
    gate = { requiresApproval: false };
    await svc.launchCampaign(OTHER, id, "go live now");
    return id;
  }

  it("pausing needs a reason and is always allowed for an active campaign", async () => {
    const id = await active();
    await expect(svc.pauseCampaign(OTHER, id, "")).rejects.toMatchObject({ status: 422 });
    await svc.pauseCampaign(OTHER, id, "stop for review");
    expect(status(id)).toBe("PAUSED");
  });

  it("resume re-runs every check: content that changed while paused cannot go back live", async () => {
    const id = await active();
    await svc.pauseCampaign(OTHER, id, "stop for review");
    campaigns()[0].description = "We guarantee success"; // violates policy while paused
    await expect(svc.resumeCampaign(OTHER, id, "resume now")).rejects.toMatchObject({ status: 422 });
    expect(status(id)).toBe("PAUSED");
  });

  it("resume works when nothing has changed", async () => {
    const id = await active();
    await svc.pauseCampaign(OTHER, id, "stop for review");
    await svc.resumeCampaign(OTHER, id, "resume now");
    expect(status(id)).toBe("ACTIVE");
  });

  it("a scheduled campaign whose checks now fail is parked paused instead of starting", async () => {
    const id = await approved({ startAt: new Date(Date.now() + 3_600_000), campaignKey: "later-drive" });
    gate = { requiresApproval: false };
    await svc.launchCampaign(OTHER, id, "schedule it");
    expect(status(id)).toBe("SCHEDULED");
    campaigns()[0].description = "100% guaranteed outcome"; // content drift after approval
    const out = await svc.startDueScheduledCampaigns(new Date(Date.now() + 7_200_000));
    expect(out).toEqual({ started: 0, parked: 1 });
    expect(status(id)).toBe("PAUSED");
  });

  it("a scheduled campaign whose checks still pass starts, and the audit records a system actor", async () => {
    const id = await approved({ startAt: new Date(Date.now() + 3_600_000), campaignKey: "later-drive-2" });
    gate = { requiresApproval: false };
    await svc.launchCampaign(OTHER, id, "schedule it");
    expect(await svc.startDueScheduledCampaigns(new Date(Date.now() + 7_200_000))).toEqual({ started: 1, parked: 0 });
    expect(status(id)).toBe("ACTIVE");
    expect(audits.at(-1)).toMatchObject({ action: "MARKETING_CAMPAIGN_LAUNCHED", adminId: null });
  });

  it("an ended campaign is completed automatically, and the provider is paused first", async () => {
    const id = await active();
    campaigns()[0].endAt = new Date(Date.now() - 1000);
    providerCalls.length = 0;
    expect(await svc.completeEndedCampaigns(new Date())).toBe(1);
    expect(status(id)).toBe("COMPLETED");
  });
});

describe("budget control", () => {
  async function live() {
    const id = await approved();
    gate = { requiresApproval: false };
    await svc.launchCampaign(OTHER, id, "go live now");
    return id;
  }

  it("before launch a budget change is a plain edit — but it invalidates an existing approval", async () => {
    const id = await approved();
    const out = await changeCampaignBudget(AUTHOR, id, { newTotalMinor: 2_000_000, reason: "Larger drive" });
    expect(out.approvalRequired).toBe(false);
    expect(status(id)).toBe("DRAFT");
    expect(campaigns()[0].approvedById).toBeNull();
  });

  it("on a launched campaign an increase waits for approval and changes nothing meanwhile", async () => {
    const id = await live();
    gate = { requiresApproval: true, status: "PENDING", approvalCode: "APR-9", approvalRequestId: "ar9" };
    const out = await changeCampaignBudget(OTHER, id, { newTotalMinor: 3_000_000, reason: "Performing well" });
    expect(out).toMatchObject({ approvalRequired: true, approvalCode: "APR-9" });
    expect(campaigns()[0].budgetTotalMinor).toBe(1_000_000);
    expect(rows("marketingBudgetEvent").some((e) => e.type === "INCREASE_REQUESTED")).toBe(true);
    expect(audits.some((a) => a.action === "MARKETING_BUDGET_INCREASE_REQUESTED")).toBe(true);
  });

  it("applies an approved increase only when the approved amounts still match", async () => {
    const id = await live();
    rows("approvalRequest").push({ id: "ar9", requestedPayload: { campaignId: id, newTotalMinor: 3_000_000, newDailyMinor: 50_000 } });
    gate = { requiresApproval: true, status: "READY_TO_EXECUTE", approvalCode: "APR-9", approvalRequestId: "ar9" };
    await expect(changeCampaignBudget(OTHER, id, { newTotalMinor: 4_000_000, reason: "Try a bigger number" })).rejects.toMatchObject({ status: 409 });
    expect(campaigns()[0].budgetTotalMinor).toBe(1_000_000);
    await changeCampaignBudget(OTHER, id, { newTotalMinor: 3_000_000, reason: "Performing well" });
    expect(campaigns()[0].budgetTotalMinor).toBe(3_000_000);
    expect(executed).toContain("ar9");
  });

  it("with the policy absent, one admin still cannot raise a launched budget on their own approval", async () => {
    const id = await live();
    gate = { requiresApproval: false };
    campaigns()[0].approvedById = "other"; // the same person is the approver of record
    await expect(changeCampaignBudget(OTHER, id, { newTotalMinor: 3_000_000, reason: "Quietly raise it" })).rejects.toMatchObject({ status: 403 });
    expect(campaigns()[0].budgetTotalMinor).toBe(1_000_000);
  });

  it("a decrease on a launched campaign needs no approval, and cannot go below verified spend", async () => {
    const id = await live();
    campaigns()[0].spendVerified = true; campaigns()[0].spendVerifiedMinor = 400_000;
    await expect(changeCampaignBudget(OTHER, id, { newTotalMinor: 300_000, reason: "Cut below spend" })).rejects.toMatchObject({ status: 422 });
    const out = await changeCampaignBudget(OTHER, id, { newTotalMinor: 600_000, newDailyMinor: 20_000, reason: "Scale back a little" });
    expect(out.approvalRequired).toBe(false);
    expect(campaigns()[0].budgetTotalMinor).toBe(600_000);
  });

  it("rejects non-integer, zero, negative, oversized and inconsistent amounts", async () => {
    const id = await live();
    for (const bad of [1.5, 0, -5, 3_000_000_000]) await expect(changeCampaignBudget(OTHER, id, { newTotalMinor: bad, reason: "bad value here" })).rejects.toMatchObject({ status: 422 });
    await expect(changeCampaignBudget(OTHER, id, { newTotalMinor: 100, newDailyMinor: 500, reason: "daily above total" })).rejects.toMatchObject({ status: 422 });
    await expect(changeCampaignBudget(OTHER, id, { newTotalMinor: 100_000, reason: "x" })).rejects.toMatchObject({ status: 422 });
  });

  it("provider-verified spend alerts once at the threshold and pauses the campaign at the cap — it never raises a budget", async () => {
    const id = await live();
    campaigns()[0].alertThresholdPct = 80;
    const a = await recordVerifiedSpend(id, 850_000);
    expect(a).toEqual({ alerted: true, paused: false });
    expect((await recordVerifiedSpend(id, 900_000)).alerted).toBe(false);
    const b = await recordVerifiedSpend(id, 1_000_000);
    expect(b.paused).toBe(true);
    expect(status(id)).toBe("PAUSED");
    expect(campaigns()[0].budgetTotalMinor).toBe(1_000_000);
    expect(campaigns()[0]).toMatchObject({ spendVerified: true, spendVerifiedMinor: 1_000_000 });
  });

  it("ignores impossible spend figures", async () => {
    const id = await live();
    expect(await recordVerifiedSpend(id, -1)).toEqual({ alerted: false, paused: false });
    expect(await recordVerifiedSpend(id, 1.5)).toEqual({ alerted: false, paused: false });
    expect(campaigns()[0].spendVerified).toBeFalsy();
  });
});

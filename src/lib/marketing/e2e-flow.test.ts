import { beforeEach, describe, expect, it, vi } from "vitest";

// STEP 29 §50 — service + route level tests over ONE coherent in-memory database. The REAL public pipeline (published
// form → signed tokens → idempotency claim → validation → consent → suppression → abuse limits → fail-closed dedup →
// attribution → atomic CRM lead with consent + attribution → post-capture routing, task, events) runs together with the REAL
// submit route. Only the outward edges (audit, sequence codes, tasks, assignment, referral lookup, security events,
// automation, feature flags, rate limiter) are controllable fakes.

type Row = Record<string, unknown> & { id?: string };

const db = new Map<string, Row[]>();
let idc = 0;
let tick = 0;
const rows = (t: string) => {
  if (!db.has(t)) db.set(t, []);
  return db.get(t) as Row[];
};

const DEFAULTS: Record<string, Row> = {
  lead: { status: "NEW", marketingOptIn: false },
};
const UNIQUE: Record<string, string[]> = {
  leadFormSubmission: ["idempotencyKey"],
  lead: ["leadCode"],
};

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
      continue;
    }
    if (v === null ? actual != null : actual !== v) return false;
  }
  return true;
}

function model(t: string) {
  return {
    create: async ({ data }: { data: Row }) => {
      const { events, marketingConsents, attribution, ...own } = data as Row & { events?: { create: Row }; marketingConsents?: { create: Row[] }; attribution?: { create: Row } };
      const row: Row = { id: `${t}-${++idc}`, createdAt: new Date(Date.now() + ++tick), updatedAt: new Date(), ...DEFAULTS[t], ...own };
      for (const u of UNIQUE[t] ?? []) if (row[u] != null && rows(t).some((r) => r[u] === row[u])) throw Object.assign(new Error("unique"), { code: "P2002" });
      rows(t).push(row);
      if (t === "lead") {
        if (events) rows("leadEvent").push({ id: `leadEvent-${++idc}`, leadId: row.id, ...events.create });
        for (const c of marketingConsents?.create ?? []) rows("marketingLeadConsent").push({ id: `mlc-${++idc}`, leadId: row.id, ...c });
        if (attribution) rows("leadAttribution").push({ id: `attr-${++idc}`, leadId: row.id, ...attribution.create });
      }
      return { ...row };
    },
    findFirst: async ({ where }: { where?: Row } = {}) => { const r = rows(t).find((x) => matches(x, where)); return r ? { ...r } : null; },
    findUnique: async ({ where }: { where: Row }) => { const r = rows(t).find((x) => matches(x, where)); return r ? { ...r } : null; },
    findMany: async ({ where, take }: { where?: Row; take?: number } = {}) => {
      if (failLeadLookup && t === "lead") throw new Error("db down");
      const out = rows(t).filter((x) => matches(x, where)).map((r) => ({ ...r }));
      return take ? out.slice(0, take) : out;
    },
    count: async ({ where }: { where?: Row } = {}) => rows(t).filter((x) => matches(x, where)).length,
    update: async ({ where, data }: { where: Row; data: Row }) => { const r = rows(t).find((x) => matches(x, where)); if (!r) throw new Error(`not found: ${t}`); Object.assign(r, data); return { ...r }; },
    delete: async ({ where }: { where: Row }) => { const i = rows(t).findIndex((x) => matches(x, where)); if (i < 0) throw new Error(`not found: ${t}`); const [r] = rows(t).splice(i, 1); return r; },
  };
}

let failLeadLookup = false;
const audits: Row[] = [];
const tasks: Row[] = [];
const assignments: Array<{ type: string; id: string; dept: string | null; actor: string }> = [];
const securityEvents: Row[] = [];
const enabled = new Set<string>();
let limitDenied: string | null = null;

vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_t, name: string) => model(name) }) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async (p: string) => `LPP-${p}-${String(++idc).padStart(6, "0")}`) }));
vi.mock("@/lib/workflow/engine", () => ({ createFromEvent: vi.fn(async (t: Row) => { tasks.push(t); return { id: `t${tasks.length}` }; }) }));
vi.mock("@/lib/crm/assignment-service", () => ({ autoAssign: vi.fn(async (type: string, id: string, dept: string | null, actor: string) => { assignments.push({ type, id, dept, actor }); }) }));
vi.mock("@/lib/referrals/referral-service", () => ({ resolveReferralCode: vi.fn(async () => null) }));
vi.mock("@/lib/security/event-bus", () => ({ publishSecurityEvent: vi.fn(async (e: Row) => { securityEvents.push(e); }) }));
vi.mock("@/lib/marketing/automation", () => ({ triggerAutomation: vi.fn(async () => undefined) }));
vi.mock("@/lib/ops/feature-flags", () => ({ isFeatureEnabled: vi.fn(async (k: string) => enabled.has(k)) }));
vi.mock("@/lib/ops/system-control", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), isEmergencyDisabled: vi.fn(async () => false) }));
vi.mock("@/lib/security/rate-limit-policy", () => ({
  enforceConfiguredLimit: vi.fn(async (_req: Request, name: string) => (limitDenied === name ? new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 }) : null)),
}));

vi.stubEnv("NEXTAUTH_SECRET", "e2e-secret-for-marketing-tests-0123456789abcdef");

const { captureLead } = await import("./lead-capture-service");
const { issueFormToken, issueTouchToken } = await import("./tokens");
const { computeContactHashes } = await import("./normalize");
const { onLeadProgress, onProfileVerified } = await import("./lead-progress");
const { POST: submitRoute } = await import("@/app/api/marketing/forms/[id]/submit/route");

const NOW = 1_800_000_000_000;
const HOST = "app.example.test";

function seed() {
  rows("marketingCampaign").push({ id: "camp1", code: "LPP-MCAMP-000001", channel: "META_ADS", status: "ACTIVE", language: "EN", attributionModel: "SINGLE_TOUCH", routingDepartmentId: "dept1", responsibleAdminId: "owner1", createdById: "creator1" });
  rows("leadForm").push({ id: "form1", status: "PUBLISHED", publishedVersionId: "fv1", campaignId: "camp1" });
  rows("leadFormVersion").push({
    id: "fv1", status: "APPROVED", publishedAt: new Date(NOW - 86_400_000), privacyNoticeVersionId: "STATIC_PRIVACY_POLICY",
    fields: [
      { key: "fullName", label: "Full name", required: true }, { key: "phone", label: "Mobile", required: true },
      { key: "email", label: "Email", required: false }, { key: "city", label: "City", required: false },
    ],
    consentConfig: {
      inquiryContact: { required: true, text: "I agree to be contacted about my inquiry." },
      marketingUpdates: { enabled: true, text: "Send me occasional updates by SMS or email.", defaultChecked: false },
      whatsapp: { enabled: false, defaultChecked: false },
      privacyNoticeLinkRequired: true,
    },
  });
}

const formToken = (at = NOW - 10_000) => issueFormToken({ formId: "form1", formVersionId: "fv1", now: at });
const touch = (extra: Record<string, unknown> = {}) => issueTouchToken({ campaignId: "camp1", pageId: "page1", pageVersionId: "pv1", utm: { source: "meta", medium: "paid" }, clickIdType: "fbclid", clickIdHash: "hash123", issuedAt: NOW - 60_000, ...extra });

const input = (over: Record<string, unknown> = {}) => ({
  formId: "form1", formToken: formToken(), touchToken: touch(), values: { fullName: "Ayesha Khan", phone: "0300 1234567", email: "ayesha@example.com", city: "Lahore" },
  consents: { inquiryContact: true, marketingUpdates: false }, honeypot: null, clientKey: "203.0.113.7", now: NOW, ...over,
});

beforeEach(() => {
  db.clear(); audits.length = 0; tasks.length = 0; assignments.length = 0; securityEvents.length = 0; enabled.clear();
  failLeadLookup = false; limitDenied = null; idc = 0; tick = 0;
  seed();
});

const leads = () => rows("lead");

describe("§50 happy path: campaign → published form → consent → submit → attribution → CRM lead → routing → task", () => {
  it("creates one verified-attribution CRM lead with consent evidence and routes it", async () => {
    const r = await captureLead(input());
    expect(r.status).toBe("ACCEPTED");
    expect(leads()).toHaveLength(1);
    const lead = leads()[0];
    expect(lead).toMatchObject({ campaignId: "camp1", status: "NEW", landingPageId: "page1", landingPageVersionId: "pv1", formId: "form1", formVersionId: "fv1", utmSource: "meta", utmMedium: "paid", source: "AD_CAMPAIGN", phone: "+923001234567", marketingOptIn: false });
    // attribution: verified, hash only
    const attr = rows("leadAttribution")[0];
    expect(attr).toMatchObject({ verification: "VERIFIED", campaignId: "camp1", clickIdType: "fbclid", clickIdHash: "hash123", model: "SINGLE_TOUCH" });
    // consent evidence: inquiry granted, marketing offered but NOT ticked → recorded as declined (never inferred)
    const consents = rows("marketingLeadConsent");
    expect(consents.find((c) => c.purpose === "INQUIRY_FOLLOWUP")).toMatchObject({ granted: true });
    expect(consents.filter((c) => c.purpose === "MARKETING_UPDATES").every((c) => c.granted === false)).toBe(true);
    expect(consents.every((c) => c.privacyNoticeVersionId === "STATIC_PRIVACY_POLICY")).toBe(true);
    // CRM event + submission outcome + marketing events
    expect(rows("leadEvent")[0]).toMatchObject({ leadId: lead.id, toStatus: "NEW" });
    expect(rows("leadFormSubmission")[0]).toMatchObject({ outcome: "ACCEPTED", leadId: lead.id });
    expect(rows("marketingEvent").map((e) => e.type)).toEqual(expect.arrayContaining(["FORM_SUBMITTED", "LEAD_CREATED"]));
    // routing uses the campaign owner as the assigning actor; a CRM task is created once
    expect(assignments).toEqual([{ type: "LEAD", id: lead.id, dept: "dept1", actor: "owner1" }]);
    expect(tasks.map((t) => t.taskType)).toEqual(["CRM_LEAD_REVIEW"]);
    expect(tasks[0].dedupKey).toBe(`MKT_LEAD:${lead.id}`);
    // audit trail: lead creation (CRM) and capture (marketing)
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["LEAD_CREATED", "MARKETING_LEAD_CAPTURED"]));
  });

  it("stores no raw IP, no raw click id and no raw contact value in the submission or attribution records", async () => {
    await captureLead(input());
    const dump = JSON.stringify([rows("leadFormSubmission"), rows("leadAttribution"), rows("marketingEvent")]);
    expect(dump).not.toContain("203.0.113.7");
    expect(dump).not.toContain("0300");
    expect(dump).not.toContain("ayesha@example.com");
  });

  it("registration and verification progress are recorded against the originating lead", async () => {
    await captureLead(input());
    const lead = leads()[0];
    await onLeadProgress(lead.id as string, "REGISTRATION_STARTED");
    lead.convertedProfileId = "profile1";
    await onProfileVerified("profile1");
    expect(rows("marketingEvent").map((e) => e.type)).toEqual(expect.arrayContaining(["REGISTRATION_STARTED", "VERIFICATION_COMPLETED"]));
  });

  it("progress on a lead that is not a marketing lead records nothing", async () => {
    rows("lead").push({ id: "plain", leadCode: "L-1", status: "NEW", campaignId: null, platform: null });
    await onLeadProgress("plain", "REGISTRATION_STARTED");
    expect(rows("marketingEvent").filter((e) => e.leadId === "plain")).toHaveLength(0);
  });

  it("marketing consent is recorded as granted only when the person ticked it", async () => {
    await captureLead(input({ consents: { inquiryContact: true, marketingUpdates: true } }));
    expect(leads()[0].marketingOptIn).toBe(true);
    expect(rows("marketingLeadConsent").filter((c) => c.purpose === "MARKETING_UPDATES").every((c) => c.granted === true)).toBe(true);
  });

  it("ignores a consent block the form never offered (mass-assignment safe)", async () => {
    await captureLead(input({ consents: { inquiryContact: true, whatsapp: true } }));
    expect(rows("marketingLeadConsent").some((c) => c.purpose === "WHATSAPP_CONTACT")).toBe(false);
    expect(leads()[0].marketingOptIn).toBe(false);
  });
});

describe("public-route abuse resistance (service level)", () => {
  it("a honeypot hit and a too-fast submission both look accepted but create nothing", async () => {
    const hp = await captureLead(input({ honeypot: "http://spam.example" }));
    expect(hp).toEqual({ status: "ACCEPTED", leadId: null });
    const fast = await captureLead(input({ formToken: formToken(NOW - 500) }));
    expect(fast).toEqual({ status: "ACCEPTED", leadId: null });
    expect(leads()).toHaveLength(0);
    expect(rows("leadFormSubmission").map((s) => s.outcome)).toEqual(["REJECTED_SPAM", "REJECTED_SPAM"]);
  });

  it("repeated automated activity from one source raises a security signal (once enough is seen)", async () => {
    const base = Date.now();
    for (let i = 0; i < 9; i++) await captureLead(input({ honeypot: "x", now: base + i }));
    expect(securityEvents.some((e) => e.eventType === "MARKETING_LEAD_ABUSE_SUSPECTED")).toBe(true);
  });

  it("a tampered or missing touch token never claims verified attribution", async () => {
    const t = touch();
    await captureLead(input({ touchToken: t.slice(0, -3) + "abc" }));
    await captureLead(input({ touchToken: null, formToken: formToken(NOW - 20_000), values: { fullName: "B Person", phone: "0311 7654321" } }));
    const verifications = rows("leadAttribution").map((a) => a.verification);
    expect(verifications).toEqual(["UNVERIFIED", "UNVERIFIED"]);
    // and a forged UTM set is not recorded at all
    expect(rows("leadAttribution").every((a) => JSON.stringify(a.utm) === "{}")).toBe(true);
  });

  it("a form token for another form version is stale, an expired one too", async () => {
    const wrong = issueFormToken({ formId: "form1", formVersionId: "other", now: NOW - 10_000 });
    expect(await captureLead(input({ formToken: wrong }))).toEqual({ status: "STALE_TOKEN" });
    expect(await captureLead(input({ formToken: formToken(NOW - 3 * 3_600_000) }))).toEqual({ status: "STALE_TOKEN" });
    expect(leads()).toHaveLength(0);
  });

  it("replaying the same token creates exactly one lead", async () => {
    const token = formToken();
    const a = await captureLead(input({ formToken: token }));
    const b = await captureLead(input({ formToken: token }));
    expect(a.status).toBe("ACCEPTED");
    expect(b.status).toBe("ACCEPTED");
    expect(leads()).toHaveLength(1);
  });

  it("validation errors do not consume the token, so the person can correct and resubmit", async () => {
    const token = formToken();
    expect((await captureLead(input({ formToken: token, values: { fullName: "A", phone: "12" } }))).status).toBe("INVALID");
    expect((await captureLead(input({ formToken: token }))).status).toBe("ACCEPTED");
    expect(leads()).toHaveLength(1);
  });

  it("consent to be contacted is required", async () => {
    const r = await captureLead(input({ consents: { inquiryContact: false } }));
    expect(r.status).toBe("INVALID");
    expect(leads()).toHaveLength(0);
  });

  it("a form that is unpublished is unavailable", async () => {
    rows("leadForm")[0].status = "UNPUBLISHED";
    expect(await captureLead(input())).toEqual({ status: "UNAVAILABLE" });
  });

  it("unknown values keys are dropped, not stored", async () => {
    await captureLead(input({ values: { fullName: "Ayesha", phone: "0300 1234567", religion: "x", isAdmin: true } }));
    expect(JSON.stringify(leads()[0])).not.toContain("religion");
  });

  it("extreme volume for one contact is rejected quietly and flagged for review", async () => {
    const h = computeContactHashes({ phone: "0300 1234567" });
    for (let i = 0; i < 6; i++) rows("leadFormSubmission").push({ id: `old${i}`, idempotencyKey: `old${i}`, phoneHash: h.phoneHash, outcome: "ACCEPTED", createdAt: new Date(NOW - 1000) });
    const r = await captureLead(input());
    expect(r).toEqual({ status: "ACCEPTED", leadId: null });
    expect(leads()).toHaveLength(0);
    expect(securityEvents.some((e) => e.eventType === "MARKETING_LEAD_ABUSE_SUSPECTED")).toBe(true);
  });
});

describe("suppression and de-duplication", () => {
  it("a suppressed contact is never captured, and the response is indistinguishable", async () => {
    const h = computeContactHashes({ phone: "0300 1234567" });
    rows("communicationSuppression").push({ id: "s1", destinationHash: h.phoneHash, status: "ACTIVE", scope: "MARKETING", expiresAt: null });
    const r = await captureLead(input());
    expect(r).toEqual({ status: "ACCEPTED", leadId: null });
    expect(leads()).toHaveLength(0);
    expect(rows("leadFormSubmission")[0].outcome).toBe("SUPPRESSED");
  });

  it("a suppression recorded against the raw number as typed elsewhere still blocks it", async () => {
    const h = computeContactHashes({ phone: "03001234567" });
    const rawHash = h.suppressionHashes.find((x) => x !== h.phoneHash) as string;
    rows("communicationSuppression").push({ id: "s2", destinationHash: rawHash, status: "ACTIVE", scope: "ALL", expiresAt: null });
    await captureLead(input());
    expect(leads()).toHaveLength(0);
  });

  it("a lifted or expired suppression does not block", async () => {
    const h = computeContactHashes({ phone: "0300 1234567" });
    rows("communicationSuppression").push({ id: "s3", destinationHash: h.phoneHash, status: "LIFTED", scope: "ALL", expiresAt: null });
    await captureLead(input());
    expect(leads()).toHaveLength(1);
  });

  it("the same identifiers again are a certain repeat: no new lead, one event on the original", async () => {
    const first = await captureLead(input());
    const second = await captureLead(input({ formToken: formToken(NOW - 20_000), clientKey: "198.51.100.9" }));
    expect(leads()).toHaveLength(1);
    expect(second).toEqual({ status: "ACCEPTED", leadId: (first as { leadId: string }).leadId });
    expect(rows("leadEvent").filter((e) => e.reason === "Repeat marketing form submission (same identifiers)")).toHaveLength(1);
    expect(assignments).toHaveLength(1);
    expect(tasks).toHaveLength(1);
  });

  it("a partly matching identifier creates a flagged lead and a review task — never an auto-merge, never routed", async () => {
    await captureLead(input());
    await captureLead(input({ formToken: formToken(NOW - 20_000), values: { fullName: "A. Khan", phone: "0300 1234567", email: "different@example.com" } }));
    expect(leads()).toHaveLength(2);
    const flagged = leads()[1];
    expect(flagged.status).toBe("DUPLICATE_REVIEW_REQUIRED");
    expect(flagged.duplicateOfLeadId).toBe(leads()[0].id);
    expect(tasks.map((t) => t.taskType)).toEqual(["CRM_LEAD_REVIEW", "CRM_DUPLICATE_REVIEW"]);
    expect(assignments).toHaveLength(1); // only the first lead was routed
  });

  it("fails CLOSED: a lookup error creates nothing and releases the claim so the retry works", async () => {
    const token = formToken();
    failLeadLookup = true;
    await expect(captureLead(input({ formToken: token }))).rejects.toThrow("db down");
    expect(leads()).toHaveLength(0);
    expect(rows("leadFormSubmission")).toHaveLength(0);
    failLeadLookup = false;
    expect((await captureLead(input({ formToken: token }))).status).toBe("ACCEPTED");
    expect(leads()).toHaveLength(1);
  });
});

describe("POST /api/marketing/forms/[id]/submit", () => {
  const post = async (body: unknown, headers: Record<string, string> = {}) =>
    submitRoute(
      new Request(`https://${HOST}/api/marketing/forms/form1/submit`, { method: "POST", headers: { "Content-Type": "application/json", origin: `https://${HOST}`, host: HOST, "x-forwarded-for": "203.0.113.7", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }),
      { params: Promise.resolve({ id: "form1" }) },
    );
  const body = (over: Record<string, unknown> = {}) => ({ token: formToken(Date.now() - 10_000), touch: touch({ issuedAt: Date.now() - 60_000 }), values: { fullName: "Ayesha Khan", phone: "0300 1234567" }, consents: { inquiryContact: true }, ...over });

  it("answers a neutral 503 while the flags are off, and never touches the database", async () => {
    const res = await post(body());
    expect(res.status).toBe(503);
    expect(leads()).toHaveLength(0);
    expect(rows("leadFormSubmission")).toHaveLength(0);
  });

  describe("with the flags on", () => {
    beforeEach(() => { enabled.add("marketing.enabled"); enabled.add("marketing.lead_capture.enabled"); });

    it("rejects cross-origin and origin-less posts", async () => {
      expect((await post(body(), { origin: "https://evil.example" })).status).toBe(403);
      const noOrigin = await submitRoute(new Request(`https://${HOST}/x`, { method: "POST", headers: { host: HOST }, body: JSON.stringify(body()) }), { params: Promise.resolve({ id: "form1" }) });
      expect(noOrigin.status).toBe(403);
      expect(leads()).toHaveLength(0);
    });

    it("applies the per-IP and per-destination rate limits", async () => {
      limitDenied = "marketing-form-submit";
      expect((await post(body())).status).toBe(429);
      limitDenied = "marketing-form-submit-destination";
      expect((await post(body())).status).toBe(429);
      expect(leads()).toHaveLength(0);
    });

    it("rejects malformed and oversized bodies", async () => {
      expect((await post("{not json")).status).toBe(400);
      expect((await post({ nope: true })).status).toBe(400);
      expect((await post("x".repeat(25_000))).status).toBe(413);
    });

    it("accepted, repeat, suppressed, honeypot and flagged submissions all return the identical body", async () => {
      const bodies: string[] = [];
      const run = async (b: Record<string, unknown>) => { const r = await post(b); expect(r.status).toBe(200); bodies.push(await r.text()); };
      await run(body());                                            // accepted
      await run(body());                                            // certain repeat (new token each time)
      await run(body({ hp: "bot" }));                               // honeypot
      const h = computeContactHashes({ phone: "0311 2223334" });
      rows("communicationSuppression").push({ id: "s9", destinationHash: h.phoneHash, status: "ACTIVE", scope: "ALL", expiresAt: null });
      await run(body({ values: { fullName: "Sup Pressed", phone: "0311 2223334" } })); // suppressed
      await run(body({ values: { fullName: "Part Match", phone: "0300 1234567", email: "other@example.com" } })); // flagged duplicate
      expect(new Set(bodies).size).toBe(1);
      expect(bodies[0]).toBe(JSON.stringify({ ok: true }));
      expect(bodies[0]).not.toMatch(/duplicate|suppress|exists|already/i);
    });

    it("a stale token tells the person to reload — and nothing else about the system", async () => {
      const res = await post(body({ token: issueFormToken({ formId: "form1", formVersionId: "fv1", now: Date.now() - 5 * 3_600_000 }) }));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("STALE_TOKEN");
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

// STEP 29 §31/§50 — provider webhook fixtures over an in-memory database: handshake, signature verification over the
// RAW body, replay/idempotency, stale events, flag-off acknowledgement, Meta lead retrieval (mocked fetch only — no live
// credentials exist) and WhatsApp inbound capture. The real webhook service, adapters, dedup, suppression and lead
// pipeline run together.

type Row = Record<string, unknown> & { id?: string };
const db = new Map<string, Row[]>();
let idc = 0;
let tick = 0;
const rows = (t: string) => {
  if (!db.has(t)) db.set(t, []);
  return db.get(t) as Row[];
};
const UNIQUE: Record<string, string[]> = { marketingWebhookEvent: ["idempotencyKey"], lead: ["leadCode"] };

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR") { if (!(v as Row[]).some((w) => matches(row, w))) return false; continue; }
    if (k.endsWith("_providerLeadId") || k === "platform_providerLeadId") { if (!matches(row, v as Row)) return false; continue; }
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
      const row: Row = { id: `${t}-${++idc}`, createdAt: new Date(Date.now() + ++tick), receivedAt: new Date(), ...own };
      for (const u of UNIQUE[t] ?? []) if (row[u] != null && rows(t).some((r) => r[u] === row[u])) throw Object.assign(new Error("unique"), { code: "P2002" });
      rows(t).push(row);
      if (t === "lead") {
        if (events) rows("leadEvent").push({ id: `le-${++idc}`, leadId: row.id, ...events.create });
        for (const c of marketingConsents?.create ?? []) rows("marketingLeadConsent").push({ id: `c-${++idc}`, leadId: row.id, ...c });
        if (attribution) rows("leadAttribution").push({ id: `a-${++idc}`, leadId: row.id, ...attribution.create });
      }
      return { ...row };
    },
    findFirst: async ({ where }: { where?: Row } = {}) => { const r = rows(t).find((x) => matches(x, where)); return r ? { ...r } : null; },
    findUnique: async ({ where }: { where: Row }) => { const r = rows(t).find((x) => matches(x, where)); return r ? { ...r } : null; },
    findMany: async ({ where, take }: { where?: Row; take?: number } = {}) => { const out = rows(t).filter((x) => matches(x, where)).map((r) => ({ ...r })); return take ? out.slice(0, take) : out; },
    count: async ({ where }: { where?: Row } = {}) => rows(t).filter((x) => matches(x, where)).length,
    update: async ({ where, data }: { where: Row; data: Row }) => { const r = rows(t).find((x) => matches(x, where)); if (!r) throw new Error(`not found: ${t}`); Object.assign(r, data); return { ...r }; },
  };
}

const audits: Row[] = [];
const tasks: Row[] = [];
const securityEvents: Row[] = [];
const enabled = new Set<string>();

vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_t, name: string) => model(name) }) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async (p: string) => `LPP-${p}-${String(++idc).padStart(6, "0")}`) }));
vi.mock("@/lib/workflow/engine", () => ({ createFromEvent: vi.fn(async (t: Row) => { tasks.push(t); return { id: "t" }; }) }));
vi.mock("@/lib/crm/assignment-service", () => ({ autoAssign: vi.fn(async () => undefined) }));
vi.mock("@/lib/security/event-bus", () => ({ publishSecurityEvent: vi.fn(async (e: Row) => { securityEvents.push(e); }) }));
vi.mock("@/lib/marketing/automation", () => ({ triggerAutomation: vi.fn(async () => undefined) }));
vi.mock("@/lib/ops/feature-flags", () => ({ isFeatureEnabled: vi.fn(async (k: string) => enabled.has(k)) }));
vi.mock("@/lib/ops/system-control", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), isEmergencyDisabled: vi.fn(async () => false) }));
vi.mock("@/lib/security/rate-limit-policy", () => ({ enforceConfiguredLimit: vi.fn(async () => null) }));

const META_SECRET = "meta-app-secret-fixture";
const WA_SECRET = "wa-app-secret-fixture";
vi.stubEnv("NEXTAUTH_SECRET", "webhook-test-secret-0123456789abcdef0123");
vi.stubEnv("META_APP_SECRET", META_SECRET);
vi.stubEnv("META_LEADS_VERIFY_TOKEN", "verify-me");
vi.stubEnv("WHATSAPP_APP_SECRET", WA_SECRET);
vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "wa-verify");

const { handleMarketingWebhook, handleWebhookHandshake } = await import("./webhook-service");
const { computeContactHashes } = await import("./normalize");
const { POST: webhookPost, GET: webhookGet } = await import("@/app/api/marketing/webhooks/[provider]/route");

const sign = (secret: string, body: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const NOW = Date.now();
const leads = () => rows("lead");

const leadgenBody = (id = "123456789012345", createdSecs = Math.floor(NOW / 1000)) =>
  JSON.stringify({ object: "page", entry: [{ id: "page1", changes: [{ field: "leadgen", value: { leadgen_id: id, form_id: "111111", ad_id: "ad-777", page_id: "page1", created_time: createdSecs } }] }] });

const waBody = (over: { id?: string; from?: string; text?: string; ts?: number } = {}) =>
  JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: over.from ?? "923001112223", profile: { name: "Sana" } }], messages: [{ id: over.id ?? "wamid.1", from: over.from ?? "923001112223", timestamp: String(over.ts ?? Math.floor(NOW / 1000)), type: "text", text: { body: over.text ?? "Assalam o alaikum, ref: spring-2026" } }] } }] }] });

const call = (provider: string, raw: string, secret: string | null, extra: Record<string, string> = {}) =>
  handleMarketingWebhook(provider, { rawBody: raw, headers: secret ? { "x-hub-signature-256": sign(secret, raw), ...extra } : extra, url: "https://app.example.test/api/marketing/webhooks/" + provider }, NOW);

beforeEach(() => {
  db.clear(); audits.length = 0; tasks.length = 0; securityEvents.length = 0; enabled.clear(); idc = 0; tick = 0;
  enabled.add("marketing.enabled"); enabled.add("marketing.lead_capture.enabled");
  rows("marketingCampaign").push({ id: "camp1", code: "LPP-MCAMP-000001", channel: "META_ADS", status: "ACTIVE", language: "EN", attributionModel: "SINGLE_TOUCH", routingDepartmentId: null, responsibleAdminId: "owner1", createdById: "c1" });
  rows("marketingAdNode").push({ id: "n1", campaignId: "camp1", externalId: "ad-777" });
});
afterEach(() => { vi.unstubAllGlobals(); vi.stubEnv("META_PAGE_ACCESS_TOKEN", ""); });

describe("subscription handshake", () => {
  it("answers the challenge only for the right verify token", () => {
    expect(handleWebhookHandshake("meta", new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "42" }))).toMatchObject({ status: 200, challenge: "42" });
    expect(handleWebhookHandshake("meta", new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "42" })).status).toBe(403);
    expect(handleWebhookHandshake("meta", new URLSearchParams({ "hub.mode": "unsubscribe", "hub.verify_token": "verify-me", "hub.challenge": "42" })).status).toBe(403);
    expect(handleWebhookHandshake("nope", new URLSearchParams()).status).toBe(404);
  });
  it("the GET route returns the challenge as plain text", async () => {
    const res = await webhookGet(new Request("https://app.example.test/api/marketing/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc"), { params: Promise.resolve({ provider: "meta" }) });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("abc");
  });
});

describe("signature verification over the raw body", () => {
  it("rejects a missing, malformed or wrong signature with a flat 401 and stores nothing but the rejection", async () => {
    const raw = leadgenBody();
    for (const headers of [{}, { "x-hub-signature-256": "sha256=" + "0".repeat(64) }, { "x-hub-signature-256": "md5=abc" }] as Array<Record<string, string>>) {
      const r = await handleMarketingWebhook("meta", { rawBody: raw, headers, url: "u" }, NOW);
      expect(r).toEqual({ status: 401, body: { error: "Invalid signature." } });
    }
    expect(leads()).toHaveLength(0);
    expect(rows("marketingWebhookEvent").every((e) => e.status === "REJECTED")).toBe(true);
    expect(audits.some((a) => a.action === "MARKETING_WEBHOOK_REJECTED")).toBe(true);
  });
  it("a body altered after signing is rejected (the signature covers the raw bytes)", async () => {
    const raw = leadgenBody();
    const r = await handleMarketingWebhook("meta", { rawBody: raw.replace("123456789012345", "999999999999999"), headers: { "x-hub-signature-256": sign(META_SECRET, raw) }, url: "u" }, NOW);
    expect(r.status).toBe(401);
  });
  it("a WhatsApp payload signed with the Meta Ads secret is rejected (separate secrets)", async () => {
    expect((await call("whatsapp", waBody(), META_SECRET)).status).toBe(401);
  });
  it("without a configured secret every delivery is rejected", async () => {
    vi.stubEnv("META_APP_SECRET", "");
    expect((await call("meta", leadgenBody(), META_SECRET)).status).toBe(401);
    vi.stubEnv("META_APP_SECRET", META_SECRET);
  });
  it("a burst of rejections raises a security signal", async () => {
    for (let i = 0; i < 6; i++) await handleMarketingWebhook("meta", { rawBody: leadgenBody(), headers: {}, url: "u" }, NOW + i);
    expect(securityEvents.some((e) => e.eventType === "MARKETING_WEBHOOK_ANOMALY")).toBe(true);
  });
  it("the route answers 401 without detail and never echoes the payload", async () => {
    const res = await webhookPost(new Request("https://app.example.test/api/marketing/webhooks/meta", { method: "POST", body: leadgenBody() }), { params: Promise.resolve({ provider: "meta" }) });
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("leadgen");
  });
});

describe("flags", () => {
  it("with marketing off a validly signed delivery is acknowledged and nothing is stored", async () => {
    enabled.clear();
    const r = await call("meta", leadgenBody(), META_SECRET);
    expect(r).toEqual({ status: 200, body: { skipped: true } });
    expect(rows("marketingWebhookEvent")).toHaveLength(0);
    expect(leads()).toHaveLength(0);
  });
  it("with lead capture off (master on) it is also skipped", async () => {
    enabled.delete("marketing.lead_capture.enabled");
    expect((await call("meta", leadgenBody(), META_SECRET)).body).toEqual({ skipped: true });
  });
});

describe("Meta lead ads", () => {
  it("without a page access token the event is parked as PENDING_FETCH — no lead is invented", async () => {
    const r = await call("meta", leadgenBody(), META_SECRET);
    expect(r.status).toBe(200);
    expect(rows("marketingWebhookEvent")[0]).toMatchObject({ status: "PENDING_FETCH", rejectReason: "AWAITING_LEAD_RETRIEVAL" });
    expect(leads()).toHaveLength(0);
  });

  describe("with a page token and a mocked Graph API", () => {
    beforeEach(() => {
      vi.stubEnv("META_PAGE_ACCESS_TOKEN", "page-token");
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ad_id: "ad-777", form_id: "111111", field_data: [{ name: "full_name", values: ["Hina Malik"] }, { name: "phone_number", values: ["+92 321 5550100"] }, { name: "email", values: ["Hina@Example.com"] }, { name: "city", values: ["Karachi"] }] }) })));
    });

    it("creates a CRM lead mapped to the campaign by ad id, with verified attribution and inquiry-only consent", async () => {
      const r = await call("meta", leadgenBody(), META_SECRET);
      expect(r.body).toEqual({ ok: true, processed: 1 });
      expect(leads()).toHaveLength(1);
      expect(leads()[0]).toMatchObject({ platform: "META_LEADGEN", providerLeadId: "123456789012345", campaignId: "camp1", phone: "+923215550100", email: "hina@example.com", marketingOptIn: false, status: "NEW" });
      expect(rows("leadAttribution")[0]).toMatchObject({ verification: "VERIFIED", campaignId: "camp1" });
      expect(rows("marketingLeadConsent").every((c) => c.purpose === "INQUIRY_FOLLOWUP")).toBe(true);
      expect(tasks.map((t) => t.taskType)).toContain("CRM_LEAD_REVIEW");
      expect(rows("marketingWebhookEvent")[0].status).toBe("PROCESSED");
    });

    it("replaying the same delivery creates exactly one lead (idempotent)", async () => {
      const raw = leadgenBody();
      await call("meta", raw, META_SECRET);
      const second = await call("meta", raw, META_SECRET);
      expect(second.body).toEqual({ ok: true, processed: 0 });
      expect(leads()).toHaveLength(1);
      expect(rows("marketingWebhookEvent").filter((e) => e.idempotencyKey === "META_LEADGEN:leadgen:123456789012345")).toHaveLength(1);
    });

    it("a second lead-gen id for the same person is a repeat, not a new lead", async () => {
      await call("meta", leadgenBody("123456789012345"), META_SECRET);
      await call("meta", leadgenBody("123456789012399"), META_SECRET);
      expect(leads()).toHaveLength(1);
    });

    it("a suppressed person is skipped", async () => {
      const h = computeContactHashes({ phone: "+92 321 5550100" });
      rows("communicationSuppression").push({ id: "s1", destinationHash: h.phoneHash, status: "ACTIVE", scope: "ALL", expiresAt: null });
      await call("meta", leadgenBody(), META_SECRET);
      expect(leads()).toHaveLength(0);
      expect(rows("marketingWebhookEvent")[0]).toMatchObject({ status: "SKIPPED", rejectReason: "SUPPRESSED" });
    });

    it("a provider failure marks the event FAILED and never loses the pipeline", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
      const r = await call("meta", leadgenBody(), META_SECRET);
      expect(r.status).toBe(200);
      expect(rows("marketingWebhookEvent")[0].status).toBe("FAILED");
      expect(leads()).toHaveLength(0);
    });
  });

  it("events older than seven days are skipped", async () => {
    const old = Math.floor((NOW - 8 * 86_400_000) / 1000);
    expect((await call("meta", leadgenBody("123456789012345", old), META_SECRET)).body).toEqual({ ok: true, processed: 0 });
    expect(rows("marketingWebhookEvent")).toHaveLength(0);
  });

  it("garbage that is validly signed is acknowledged without effect", async () => {
    expect((await call("meta", "not json", META_SECRET)).body).toEqual({ ok: true, events: 0 });
    expect((await call("meta", JSON.stringify({ entry: [{ changes: [{ field: "feed", value: {} }] }] }), META_SECRET)).body).toEqual({ ok: true, events: 0 });
  });
});

describe("WhatsApp inbound capture", () => {
  it("creates a lead from the person's own message, unverified, with no opt-in and a clipped inquiry", async () => {
    const r = await call("whatsapp", waBody({ text: "Salam " + "x".repeat(400) }), WA_SECRET);
    expect(r.body).toEqual({ ok: true, processed: 1 });
    expect(leads()[0]).toMatchObject({ platform: "WHATSAPP", providerLeadId: "wamid.1", phone: "+923001112223", marketingOptIn: false, source: "WHATSAPP" });
    expect(String(leads()[0].inquiry).length).toBeLessThanOrEqual(300);
    expect(rows("leadAttribution")[0].verification).toBe("UNVERIFIED");
    expect(rows("marketingEvent").map((e) => e.type)).toContain("WHATSAPP_STARTED");
  });

  it("a campaign reference typed in the message is only an unverified claim and never attaches the lead to a campaign", async () => {
    await call("whatsapp", waBody({ text: "ref: LPP-MCAMP-000001" }), WA_SECRET);
    expect(leads()[0].campaignId).toBeNull();
    expect(rows("leadAttribution")[0].campaignId).toBeNull();
  });

  it("a replayed message id creates one lead", async () => {
    const raw = waBody();
    await call("whatsapp", raw, WA_SECRET);
    await call("whatsapp", raw, WA_SECRET);
    expect(leads()).toHaveLength(1);
  });

  it("ignores messages with malformed sender numbers", async () => {
    expect((await call("whatsapp", waBody({ from: "not-a-number" }), WA_SECRET)).body).toEqual({ ok: true, events: 0 });
    expect(leads()).toHaveLength(0);
  });

  it("a person who is suppressed does not become a lead", async () => {
    const h = computeContactHashes({ phone: "+923001112223" });
    rows("communicationSuppression").push({ id: "s2", destinationHash: h.phoneHash, status: "ACTIVE", scope: "MARKETING", expiresAt: null });
    await call("whatsapp", waBody(), WA_SECRET);
    expect(leads()).toHaveLength(0);
  });
});

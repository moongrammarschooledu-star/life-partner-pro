import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

// STEP 25 service-level tests over ONE coherent in-memory database. The REAL policy engine, send/queue service, provider registry,
// adapters (Twilio with a mocked fetch), webhook pipeline, suppression service, template / campaign / thread services and event
// dispatch run together; only the outward edges (audit, tasks, approval gate, feature flags, restrictions, jurisdiction rules,
// family membership, record-access helpers) are controllable fakes.

type Row = Record<string, unknown> & { id?: string | number };
const DEFAULTS: Record<string, Row> = {
  communicationLog: { deliveryStatus: "QUEUED", attempts: 0, retryCount: 0, bodyEncrypted: false, isTest: false, recipientType: "PROFILE" },
  communicationSuppression: { status: "ACTIVE", scope: "ALL" },
  communicationThread: { status: "OPEN" },
  communicationThreadMember: { canReply: true },
  communicationTemplate: { status: "DRAFT", currentVersion: 1 },
  communicationCampaign: { status: "DRAFT" },
};

const db = new Map<string, Row[]>();
let idc = 0;
let tick = 0;
const rows = (t: string) => {
  if (!db.has(t)) db.set(t, []);
  return db.get(t) as Row[];
};

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR") { if (!(v as Row[]).some((w) => matches(row, w))) return false; continue; }
    if (k === "AND") { if (!(v as Row[]).every((w) => matches(row, w))) return false; continue; }
    if (k.includes("_") && v && typeof v === "object" && !(v instanceof Date)) { // compound unique key, e.g. profileId_channel
      if (!matches(row, v as Row)) return false;
      continue;
    }
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
      continue;
    }
    if (v === null ? actual != null : actual !== v) return false;
  }
  return true;
}

function sortRows(list: Row[], orderBy: unknown): Row[] {
  const order = (Array.isArray(orderBy) ? orderBy[0] : orderBy) as Record<string, "asc" | "desc"> | undefined;
  if (!order) return list;
  const [field, dir] = Object.entries(order)[0];
  return [...list].sort((a, b) => {
    const x = a[field] as number | Date; const y = b[field] as number | Date;
    const r = x instanceof Date ? x.getTime() - (y as Date).getTime() : (x as number) - (y as number);
    return dir === "desc" ? -r : r;
  });
}

function withRelations(t: string, r: Row): Row {
  const out = { ...r };
  if (t === "communicationThread") out.members = rows("communicationThreadMember").filter((m) => m.threadId === r.id);
  return out;
}

function model(t: string) {
  return {
    create: async ({ data }: { data: Row }) => {
      const row: Row = { id: `${t}-${++idc}`, createdAt: new Date(Date.now() + ++tick), updatedAt: new Date(), ...DEFAULTS[t], ...data };
      for (const uniq of ["dedupKey", "idempotencyKey", "templateCode", "threadCode"]) {
        if (row[uniq] != null && rows(t).some((r) => r[uniq] === row[uniq])) throw Object.assign(new Error("unique"), { code: "P2002" });
      }
      rows(t).push(row);
      return { ...row };
    },
    createMany: async ({ data }: { data: Row[] }) => { for (const d of data) await model(t).create({ data: d }); return { count: data.length }; },
    findFirst: async ({ where, orderBy }: { where?: Row; orderBy?: unknown } = {}) => { const r = sortRows(rows(t).filter((x) => matches(x, where)), orderBy ?? { createdAt: "desc" })[0]; return r ? withRelations(t, r) : null; },
    findUnique: async ({ where }: { where: Row }) => { const r = rows(t).find((x) => matches(x, where)); return r ? withRelations(t, r) : null; },
    findMany: async ({ where, take, orderBy }: { where?: Row; take?: number; orderBy?: unknown } = {}) => { const out = sortRows(rows(t).filter((x) => matches(x, where)), orderBy).map((r) => withRelations(t, r)); return take ? out.slice(0, take) : out; },
    count: async ({ where }: { where?: Row } = {}) => rows(t).filter((x) => matches(x, where)).length,
    update: async ({ where, data }: { where: Row; data: Row }) => { const r = rows(t).find((x) => matches(x, where)); if (!r) throw new Error(`not found: ${t}`); applyData(r, data); return { ...r }; },
    updateMany: async ({ where, data }: { where?: Row; data: Row }) => { const hit = rows(t).filter((x) => matches(x, where)); hit.forEach((r) => applyData(r, data)); return { count: hit.length }; },
    upsert: async ({ where, update, create }: { where: Row; update: Row; create: Row }) => { const r = rows(t).find((x) => matches(x, where)); if (r) { applyData(r, update); return { ...r }; } return model(t).create({ data: create }); },
    groupBy: async () => [],
  };
}
function applyData(r: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && !(v instanceof Date) && "increment" in (v as Row)) r[k] = ((r[k] as number) ?? 0) + ((v as Row).increment as number);
    else r[k] = v;
  }
  r.updatedAt = new Date();
}

const audits: Row[] = [];
const tasks: Row[] = [];
const adminNotes: Row[] = [];
const enabledFlags = new Set<string>();
let killSwitch = false;
const restrictions = new Map<string, Set<string>>();
let jurisdictionRule: { allowed?: boolean; reviewRequired?: boolean } | null = null;
let gate: { requiresApproval: boolean; status?: string; approvalRequestId?: string; approvalCode?: string } = { requiresApproval: false };
const families = new Map<string, { applicantId: string }>();

vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_t, name: string) => model(name) }) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async (p: string) => `LPP-${p}-${String(++idc).padStart(6, "0")}`) }));
vi.mock("@/lib/workflow/engine", () => ({ createFromEvent: vi.fn(async (t: Row) => { tasks.push(t); return { id: `t${tasks.length}` }; }) }));
vi.mock("@/lib/ops/feature-flags", () => ({ isFeatureEnabled: vi.fn(async (k: string) => enabledFlags.has(k)) }));
vi.mock("@/lib/ops/system-control", () => ({ isEmergencyDisabled: vi.fn(async () => killSwitch) }));
vi.mock("@/lib/profile-restrictions", () => ({ hasActiveRestriction: vi.fn(async (id: string, type: string) => restrictions.get(id)?.has(type) ?? false) }));
vi.mock("@/lib/compliance/rule-engine", () => ({ evaluateRequirement: vi.fn(async () => (jurisdictionRule ? { resolved: true, value: jurisdictionRule } : { resolved: false, value: null })) }));
vi.mock("@/lib/approvals/gate", () => ({ enforceApprovalGate: vi.fn(async () => gate), markApprovalExecuted: vi.fn(async () => undefined) }));
vi.mock("@/lib/family/access-control", () => ({ getFamilyMembership: vi.fn(async (id: string) => families.get(id) ?? null), hasFamilyPermission: vi.fn(async () => true) }));
vi.mock("@/lib/profile-assignment-access", () => ({ assertProfileAssignmentAccess: vi.fn(async () => undefined) }));
vi.mock("@/lib/communication-access", () => ({ assertCommunicationAccess: vi.fn(() => undefined) }));
vi.mock("@/lib/case-access", () => ({ resolveCaseAccessLevel: vi.fn(async () => "FULL") }));
vi.mock("@/lib/route-guard", () => ({ ApiError: class ApiError extends Error {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.stubEnv("NEXTAUTH_SECRET", "e2e-secret-for-communication-tests-0123456789abcdef");
vi.stubEnv("TWILIO_ACCOUNT_SID", "ACe2e");
vi.stubEnv("TWILIO_AUTH_TOKEN", "e2e-token");
vi.stubEnv("TWILIO_FROM_NUMBER", "+15550001111");
vi.stubEnv("COMMUNICATION_TEST_RECIPIENTS", "+923009990001");
vi.stubEnv("APP_ENV", "development");

const { canSend } = await import("./policy-engine");
const { communicate, deliverLog, processCommunicationQueue, listDeadLetters, retryDeadLetter, backoffSeconds } = await import("./send-service");
const { handleProviderWebhook } = await import("./webhook-service");
const { sandboxWebhookSecret } = await import("./providers/sandbox-adapter");
const { signEnvelope } = await import("./providers/shared");
const { addSuppression } = await import("./suppression-service");
const { createTemplate, submitTemplate, approveTemplate, activateTemplate, editTemplate } = await import("./template-service");
const { createThread, postStaffMessage, addInternalComment, getThreadForProfile, listThreadsForProfile, getThreadForFamilyMember, postProfileMessage, listStaffThreadMessages } = await import("./thread-service");
const { assertAudienceAllowed, approveCampaign } = await import("./campaign-service");
const { dispatchEventToExternalChannels } = await import("./event-dispatch");
const { readableText } = await import("./content");
const { sweepCommunicationData } = await import("./retention");
const { sendOneTimeCode } = await import("./otp-sender");
const { clearCommunicationPolicyCache } = await import("./policy-config");
const { sendAdminComposedMessage } = await import("@/lib/notifications/notification-service");

const fetchMock = vi.fn();
const admin = (over: Row = {}) => ({ id: "a1", name: "A", email: "a@x", role: "COMMUNICATION_MANAGER", permissions: ["communications:view", "communications:send", "communications:logs:view", "communications:templates:create", "communications:templates:approve", "communications:campaigns:approve"], sid: "s", ...over }) as never;

const PHONE_A = "+923001110001";
const PHONE_B = "+923002220002";
const PAST = new Date(Date.now() - 10 * 86_400_000);

function seedProfile(id: string, over: { email?: string; phone?: string; whatsapp?: string | null; verified?: boolean; country?: string; status?: string; name?: string } = {}) {
  const contact = { mobileNumber: over.phone ?? `+92300${id.replace(/\D/g, "").padStart(7, "1")}`, whatsappNumber: over.whatsapp ?? null, email: over.email ?? `${id}@example.com` };
  rows("profile").push({ id, fullName: over.name ?? `Person ${id}`, profileCode: `LPP-${id}`, status: over.status ?? "ACTIVE", accountStatus: "ACTIVE", softDeleted: false, country: over.country ?? "Pakistan", preferredLanguage: "EN", contact, verification: over.verified === false ? { phoneVerifiedAt: null, emailVerifiedAt: null, status: "NOT_VERIFIED" } : { phoneVerifiedAt: PAST, emailVerifiedAt: PAST, status: "VERIFIED" } });
  rows("contactInfo").push({ id: `ci-${id}`, profileId: id, ...contact });
}
const intent = (over: Row = {}) => ({ recipient: { type: "PROFILE", profileId: "p1" }, channel: "EMAIL", messageType: "TRANSACTIONAL", purpose: "ACCOUNT", automated: true, ...over }) as never;
const logs = () => rows("communicationLog");
const lastLog = () => logs()[logs().length - 1];

beforeEach(() => {
  db.clear(); idc = 0; tick = 0;
  audits.length = 0; tasks.length = 0; adminNotes.length = 0;
  enabledFlags.clear(); enabledFlags.add("notifications.enabled"); enabledFlags.add("whatsapp.enabled");
  killSwitch = false; restrictions.clear(); jurisdictionRule = null; gate = { requiresApproval: false }; families.clear();
  clearCommunicationPolicyCache();
  rows("appSettings").push({ id: 1, emailNotificationsEnabled: true, smsNotificationsEnabled: true, whatsappNotificationsEnabled: true });
  seedProfile("p1", { phone: PHONE_A, email: "p1@example.com" });
  seedProfile("p2", { phone: PHONE_B, email: "p2@example.com" });
  rows("jurisdiction").push({ id: "j-pk", countryCode: "Pakistan", status: "ACTIVE", effectiveFrom: PAST });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.stubGlobal("fetch", fetchMock); vi.restoreAllMocks(); });

describe("policy engine: canSend", () => {
  it("allows an ordinary transactional e-mail, resolves the destination server-side and hashes it", async () => {
    const d = await canSend(intent());
    expect(d.allowed).toBe(true);
    expect(d.destination).toBe("p1@example.com");
    expect(d.destinationHash).toMatch(/^[0-9a-f]{20,}$/);
    expect(d.jurisdictionUnresolved).toBe(true); // a jurisdiction exists but no communication rule does: allowed, and recorded as unresolved
    jurisdictionRule = { allowed: true };
    expect((await canSend(intent())).jurisdictionUnresolved).toBe(false);
  });

  it("blocks with a reason code when the recipient does not exist, is deleted, or has no address", async () => {
    expect((await canSend(intent({ recipient: { type: "PROFILE", profileId: "nope" } }))).blockedCode).toBe("BLOCKED_RECIPIENT_NOT_FOUND");
    rows("profile").find((p) => p.id === "p2")!.softDeleted = true;
    expect((await canSend(intent({ recipient: { type: "PROFILE", profileId: "p2" } }))).blockedCode).toBe("BLOCKED_RECIPIENT_NOT_FOUND");
    expect((await canSend(intent({ channel: "WHATSAPP" }))).blockedCode).toBe("BLOCKED_NO_DESTINATION"); // never falls back to the mobile number
  });

  it("stops optional messages on revoked consent or a switched-off preference, but never security/essential ones", async () => {
    rows("communicationConsent").push({ profileId: "p1", channel: "EMAIL", status: "REVOKED" });
    expect((await canSend(intent({ eventKey: "PROPOSAL_RECEIVED", messageType: "PROPOSAL", purpose: "PROPOSAL" }))).blockedCode).toBe("BLOCKED_CONSENT");
    expect((await canSend(intent({ eventKey: "ACCOUNT_REGISTERED" }))).allowed).toBe(true); // essential
    rows("communicationConsent").length = 0;
    rows("notificationPreference").push({ profileId: "p1", emailMeetingUpdates: false });
    expect((await canSend(intent({ eventKey: "MEETING_REMINDER_24H", messageType: "MEETING", purpose: "MEETING" }))).blockedCode).toBe("BLOCKED_CONSENT");
  });

  it("marketing is separate and opt-in: switched off by default, needs preference AND consent AND a permitting jurisdiction rule", async () => {
    const marketing = intent({ messageType: "MARKETING", purpose: "MARKETING", automated: false, initiatedBy: { adminId: "a1", permissions: [] } });
    expect((await canSend(marketing)).blockedCode).toBe("BLOCKED_MARKETING_DISABLED");
    enabledFlags.add("communications.marketing.enabled");
    expect((await canSend(marketing)).blockedCode).toBe("BLOCKED_NO_MARKETING_CONSENT");
    rows("notificationPreference").push({ profileId: "p1", emailMarketing: true });
    expect((await canSend(marketing)).blockedCode).toBe("BLOCKED_NO_MARKETING_CONSENT"); // preference alone is not consent
    rows("communicationConsent").push({ profileId: "p1", channel: "EMAIL", status: "GRANTED" });
    const noRule = await canSend(marketing);
    expect(noRule.allowed).toBe(false);
    expect(noRule.blockedCode).toBe("BLOCKED_JURISDICTION_REVIEW"); // the law is not guessed
    expect(noRule.reviewRequired).toBe(true);
    jurisdictionRule = { allowed: true };
    expect((await canSend(marketing)).allowed).toBe(true);
    jurisdictionRule = { allowed: false };
    expect((await canSend(marketing)).blockedCode).toBe("BLOCKED_JURISDICTION_RULE");
    jurisdictionRule = { reviewRequired: true };
    expect((await canSend(marketing)).blockedCode).toBe("BLOCKED_JURISDICTION_REVIEW");
  });

  it("requires a VERIFIED contact for marketing", async () => {
    seedProfile("p3", { verified: false });
    enabledFlags.add("communications.marketing.enabled");
    rows("notificationPreference").push({ profileId: "p3", emailMarketing: true });
    rows("communicationConsent").push({ profileId: "p3", channel: "EMAIL", status: "GRANTED" });
    jurisdictionRule = { allowed: true };
    const d = await canSend(intent({ recipient: { type: "PROFILE", profileId: "p3" }, messageType: "MARKETING", purpose: "MARKETING", automated: false, initiatedBy: { adminId: "a1", permissions: [] } }));
    expect(d.blockedCode).toBe("BLOCKED_CONTACT_NOT_VERIFIED");
  });

  it("transactional traffic continues while the jurisdiction is unresolved (recorded), and can be configured to review or block", async () => {
    rows("profile").find((p) => p.id === "p1")!.country = "Atlantis";
    const d = await canSend(intent());
    expect(d.allowed).toBe(true);
    expect(d.jurisdictionUnresolved).toBe(true);
    rows("communicationPolicy").push({ id: "pol", kind: "JURISDICTION_DEFAULTS", policyKey: "default", status: "ACTIVE", jurisdictionScope: "GLOBAL", effectiveFrom: PAST, version: 1, configuration: JSON.stringify({ unresolvedTransactional: "REVIEW" }) });
    clearCommunicationPolicyCache();
    const review = await canSend(intent());
    expect(review.blockedCode).toBe("BLOCKED_JURISDICTION_REVIEW");
    expect(review.reviewRequired).toBe(true);
  });

  it("honours suppressions by scope, by profile and by address hash", async () => {
    await addSuppression({ channel: "EMAIL", reason: "UNSUBSCRIBED", scope: "MARKETING", profileId: "p1", destination: "p1@example.com" });
    expect((await canSend(intent())).allowed).toBe(true); // a marketing opt-out never blocks transactional mail
    await addSuppression({ channel: "EMAIL", reason: "BOUNCE", scope: "ALL", destination: "P2@example.com" }); // by address only
    const d = await canSend(intent({ recipient: { type: "PROFILE", profileId: "p2" }, messageType: "SECURITY", purpose: "SECURITY" }));
    expect(d.blockedCode).toBe("BLOCKED_SUPPRESSED"); // a hard bounce stops even security mail
    expect(JSON.stringify(rows("communicationSuppression"))).not.toContain("example.com"); // only a salted hash is stored
  });

  it("keeps frequency budgets separate per class", async () => {
    for (let i = 0; i < 10; i++) rows("communicationLog").push({ id: `l${i}`, profileId: "p1", channel: "EMAIL", messageType: "TRANSACTIONAL", createdAt: new Date() });
    expect((await canSend(intent())).blockedCode).toBe("BLOCKED_FREQUENCY");
    expect((await canSend(intent({ messageType: "SECURITY", purpose: "SECURITY" }))).allowed).toBe(true); // security budget untouched
    expect((await canSend(intent({ channel: "SMS" }))).allowed).toBe(true); // per channel
  });

  it("defers SMS in quiet hours but not security messages", async () => {
    rows("communicationPolicy").push({ id: "qh", kind: "QUIET_HOURS", policyKey: "default", status: "ACTIVE", jurisdictionScope: "GLOBAL", effectiveFrom: PAST, version: 1, configuration: JSON.stringify({ enabled: true, start: "00:00", end: "23:59", timezone: "UTC", channels: ["SMS"] }) });
    clearCommunicationPolicyCache();
    const d = await canSend(intent({ channel: "SMS", now: new Date("2026-01-01T12:00:00Z") }));
    expect(d.allowed).toBe(true);
    expect(d.deferUntil).toBeInstanceOf(Date);
    expect((await canSend(intent({ channel: "SMS", messageType: "SECURITY", purpose: "SECURITY", now: new Date("2026-01-01T12:00:00Z") }))).deferUntil).toBeUndefined();
  });

  it("risk restrictions stop person-initiated messages but never automated notices or security messages", async () => {
    restrictions.set("p1", new Set(["COMMUNICATION_RESTRICTED"]));
    const manual = intent({ automated: false, messageType: "SUPPORT", purpose: "SUPPORT", initiatedBy: { adminId: "a1", permissions: [] } });
    expect((await canSend(manual)).blockedCode).toBe("BLOCKED_RESTRICTION");
    expect((await canSend(intent())).allowed).toBe(true);
    expect((await canSend(intent({ automated: false, messageType: "SECURITY", purpose: "SECURITY", initiatedBy: { adminId: "a1", permissions: ["communications:send_sensitive"] } }))).allowed).toBe(true);
  });

  it("refuses a purpose that does not belong to the message type, and sensitive purposes without the permission", async () => {
    expect((await canSend(intent({ messageType: "TRANSACTIONAL", purpose: "MARKETING" }))).blockedCode).toBe("BLOCKED_PURPOSE_MISMATCH");
    const manual = (perms: string[]) => intent({ automated: false, messageType: "PRIVACY", purpose: "PRIVACY", initiatedBy: { adminId: "a1", permissions: perms } });
    expect((await canSend(manual([]))).blockedCode).toBe("BLOCKED_SENSITIVE_PERMISSION");
    expect((await canSend(manual(["communications:send_sensitive"]))).allowed).toBe(true);
  });

  it("family members and admins are in-app only, and a family member needs an active membership", async () => {
    expect((await canSend(intent({ recipient: { type: "FAMILY_MEMBER", familyMemberId: "f1" }, channel: "EMAIL" }))).blockedCode).toBe("BLOCKED_CHANNEL_NOT_ALLOWED_FOR_RECIPIENT");
    expect((await canSend(intent({ recipient: { type: "FAMILY_MEMBER", familyMemberId: "f1" }, channel: "IN_APP" }))).blockedCode).toBe("BLOCKED_FAMILY_ACCESS");
    families.set("f1", { applicantId: "p1" });
    expect((await canSend(intent({ recipient: { type: "FAMILY_MEMBER", familyMemberId: "f1" }, channel: "IN_APP" }))).allowed).toBe(true);
  });
});

describe("send service: queue, providers, retries, dead letters", () => {
  const send = (over: Row = {}, body = "Hello there") => communicate({ intent: intent(over), body, subject: "Subject" });

  it("stores the message ENCRYPTED, sends through the sandbox, and reports SENT - never DELIVERED", async () => {
    const r = await send();
    expect(r.status).toBe("SENT");
    const log = lastLog();
    expect(log.deliveryStatus).toBe("SENT");
    expect(log.deliveredAt ?? null).toBeNull();
    expect(log.provider).toMatch(/^sandbox-/);
    expect(String(log.messageBody)).not.toContain("Hello there");
    expect(readableText(log.messageBody as string, log.bodyEncrypted as boolean, null)).toBe("Hello there");
    expect(fetchMock).not.toHaveBeenCalled(); // e-mail has no SMTP credentials here: sandbox only
  });

  it("does not create a row at all for routine blocks (channel off / no consent), but records and audits real blocks", async () => {
    rows("appSettings")[0].smsNotificationsEnabled = false;
    const silent = await send({ channel: "SMS" });
    expect(silent).toMatchObject({ status: "BLOCKED", silent: true });
    expect(logs()).toHaveLength(0);
    restrictions.set("p1", new Set(["FULL_ACCOUNT_RESTRICTED"]));
    const recorded = await send({ automated: false, messageType: "SUPPORT", purpose: "SUPPORT", initiatedBy: { adminId: "a1", permissions: [] } });
    expect(recorded.status).toBe("BLOCKED");
    expect(lastLog()).toMatchObject({ deliveryStatus: "CANCELLED", blockedReason: "BLOCKED_RESTRICTION" });
    expect(audits.some((a) => a.action === "COMMUNICATION_BLOCKED")).toBe(true);
  });

  it("routes real providers to the sandbox outside production unless the recipient is an allow-listed tester", async () => {
    const r = await send({ channel: "SMS" });
    expect(r.status).toBe("SENT");
    expect(lastLog().provider).toBe("sandbox-sms");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the real (mocked-fetch) Twilio adapter for an allow-listed test recipient and stores the provider id", async () => {
    rows("contactInfo").find((c) => c.profileId === "p1")!.mobileNumber = "+923009990001";
    rows("profile").find((p) => p.id === "p1")!.contact = { mobileNumber: "+923009990001", whatsappNumber: null, email: "p1@example.com" };
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ sid: "SMreal" }) });
    const r = await send({ channel: "SMS" }, "Your proposal is ready");
    expect(r.status).toBe("SENT");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastLog()).toMatchObject({ provider: "builtin-sms_twilio", providerMessageId: "SMreal", deliveryStatus: "SENT" });
    const form = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(form.get("To")).toBe("+923009990001");
  });

  describe("failures", () => {
    beforeEach(() => {
      rows("contactInfo").find((c) => c.profileId === "p1")!.mobileNumber = "+923009990001";
      rows("profile").find((p) => p.id === "p1")!.contact = { mobileNumber: "+923009990001", whatsappNumber: null, email: "p1@example.com" };
    });

    it("re-queues a retryable failure with exponential backoff and dead-letters it after the last attempt", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
      const r = await send({ channel: "SMS" });
      expect(r.status).toBe("QUEUED");
      let log = lastLog();
      expect(log).toMatchObject({ deliveryStatus: "QUEUED", attempts: 1, failureClass: "RETRYABLE" });
      const wait1 = (log.nextAttemptAt as Date).getTime() - Date.now();
      expect(wait1).toBeGreaterThan(50_000);
      // not due yet: the drain must not touch it
      expect((await processCommunicationQueue()).attempted).toBe(0);
      // fast-forward through the remaining attempts
      for (let attempt = 2; attempt <= 4; attempt++) {
        log.nextAttemptAt = new Date(Date.now() - 1000);
        await deliverLog(log.id as string);
        log = lastLog();
      }
      expect(log).toMatchObject({ deliveryStatus: "FAILED", attempts: 4 });
      expect(log.deadLetteredAt).toBeInstanceOf(Date);
      expect(await listDeadLetters()).toHaveLength(1);
      expect(audits.some((a) => a.action === "COMMUNICATION_DEAD_LETTERED")).toBe(true);
      expect(backoffSeconds(3)).toBeGreaterThan(backoffSeconds(2));
    });

    it("a provider that says the number can never receive marks it REJECTED, dead-letters, and suppresses the address", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ code: 21211 }) });
      await send({ channel: "SMS" });
      expect(lastLog()).toMatchObject({ deliveryStatus: "REJECTED", failureClass: "PERMANENT" });
      expect(rows("communicationSuppression")).toHaveLength(1);
      expect(rows("communicationSuppression")[0]).toMatchObject({ channel: "SMS", reason: "PROVIDER_BLOCK", scope: "ALL" });
      // and a later message to the same number is stopped by the engine
      fetchMock.mockClear();
      expect((await send({ channel: "SMS" })).blockedCode).toBe("BLOCKED_SUPPRESSED");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("a permanent dead letter needs a provider manager to retry; a transient one can be retried by ordinary staff", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ code: 21211 }) });
      await send({ channel: "SMS" });
      const id = lastLog().id as string;
      await expect(retryDeadLetter(id, { id: "a1", permissions: ["communications:send"] })).rejects.toThrow(/provider manager/);
      await expect(retryDeadLetter("nope", { id: "a1", permissions: [] })).rejects.toThrow(/not found/i);
    });

    it("re-checks policy at SEND time: a suppression added while the message waited cancels it before any provider call", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ sid: "x" }) });
      const r = await communicate({ intent: intent({ channel: "SMS" }), body: "later", deliverNow: false });
      expect(r.status).toBe("QUEUED");
      await addSuppression({ channel: "SMS", reason: "USER_REQUEST", scope: "ALL", profileId: "p1" });
      const summary = await processCommunicationQueue();
      expect(summary.cancelled).toBe(1);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(lastLog()).toMatchObject({ deliveryStatus: "CANCELLED", blockedReason: "BLOCKED_SUPPRESSED" });
    });

    it("holds queued messages (without using an attempt) while the notification kill switch is on, then sends", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ sid: "later" }) });
      killSwitch = true;
      const r = await send({ channel: "SMS" });
      expect(r.status).toBe("QUEUED");
      expect(lastLog()).toMatchObject({ deliveryStatus: "QUEUED", attempts: 0 });
      expect(fetchMock).not.toHaveBeenCalled();
      killSwitch = false;
      lastLog().nextAttemptAt = new Date(Date.now() - 1000);
      await processCommunicationQueue();
      expect(lastLog().deliveryStatus).toBe("SENT");
    });

    it("two workers racing for the same row send it exactly once", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ sid: "once" }) });
      await communicate({ intent: intent({ channel: "SMS" }), body: "once", deliverNow: false });
      const id = lastLog().id as string;
      const [a, b] = await Promise.all([deliverLog(id), deliverLog(id)]);
      expect([a, b].sort()).toEqual(["SENT", "SKIPPED"]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("WhatsApp without an approved provider template is refused rather than tried", async () => {
    rows("contactInfo").find((c) => c.profileId === "p1")!.whatsappNumber = "+923009990001";
    rows("profile").find((p) => p.id === "p1")!.contact = { mobileNumber: PHONE_A, whatsappNumber: "+923009990001", email: "p1@example.com" };
    vi.stubEnv("WHATSAPP_ENABLED", "true");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "t");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1");
    await send({ channel: "WHATSAPP" });
    expect(lastLog()).toMatchObject({ deliveryStatus: "FAILED", failureReason: "WHATSAPP_REQUIRES_APPROVED_TEMPLATE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to send content that contains the other party's contact details", async () => {
    const r = await communicate({ intent: intent(), body: `Please call them on ${PHONE_B}`, protectedStrings: [PHONE_B, "p2@example.com"] });
    expect(r.status).toBe("BLOCKED");
    expect(r.reviewRequired).toBe(true);
    expect(logs().every((l) => l.deliveryStatus === "CANCELLED")).toBe(true);
  });
});

describe("webhooks: signature, replay, idempotency and honest status", () => {
  async function sentSmsLog(): Promise<Row> {
    await communicate({ intent: intent({ channel: "EMAIL" }), body: "hi" });
    const log = lastLog();
    log.providerMessageId = "msg-1"; // as a real provider would have returned
    return log;
  }
  const signed = (events: unknown[], ts = Math.floor(Date.now() / 1000), secret = sandboxWebhookSecret() as string) => {
    const rawBody = JSON.stringify({ events });
    return { rawBody, url: "https://app.example/api/webhooks/email", headers: { "x-webhook-timestamp": String(ts), "x-webhook-signature": signEnvelope(secret, rawBody, ts) } };
  };

  it("only a provider event moves the state: SENT -> DELIVERED -> READ, in order, exactly once", async () => {
    const log = await sentSmsLog();
    expect(log.deliveryStatus).toBe("SENT");
    const first = await handleProviderWebhook("EMAIL", signed([{ eventId: "e1", messageId: "msg-1", type: "delivered" }]));
    expect(first).toMatchObject({ httpStatus: 200, body: { processed: 1 } });
    expect(log.deliveryStatus).toBe("DELIVERED");
    expect(log.deliveredAt).toBeInstanceOf(Date);
    const dup = await handleProviderWebhook("EMAIL", signed([{ eventId: "e1", messageId: "msg-1", type: "delivered" }]));
    expect(dup.body).toMatchObject({ processed: 0, duplicates: 1 });
    await handleProviderWebhook("EMAIL", signed([{ eventId: "e2", messageId: "msg-1", type: "read" }]));
    expect(log.deliveryStatus).toBe("READ");
    await handleProviderWebhook("EMAIL", signed([{ eventId: "e3", messageId: "msg-1", type: "delivered" }])); // late, out-of-order
    expect(log.deliveryStatus).toBe("READ");
  });

  it("rejects and audits a bad signature, a missing signature, a tampered body and a stale timestamp", async () => {
    await sentSmsLog();
    const good = signed([{ eventId: "e9", messageId: "msg-1", type: "delivered" }]);
    for (const req of [
      { ...good, headers: { ...good.headers, "x-webhook-signature": "00".repeat(32) } },
      { ...good, headers: {} },
      { ...good, rawBody: good.rawBody.replace("delivered", "read") },
      signed([{ eventId: "e10", messageId: "msg-1", type: "delivered" }], Math.floor(Date.now() / 1000) - 3600),
    ]) {
      const r = await handleProviderWebhook("EMAIL", req);
      expect(r.httpStatus).toBe(401);
    }
    expect(lastLog().deliveryStatus).toBe("SENT");
    expect(audits.filter((a) => a.action === "COMMUNICATION_WEBHOOK_REJECTED")).toHaveLength(4);
  });

  it("rejects a malformed payload and ignores an event for a message we never sent", async () => {
    const bad = await handleProviderWebhook("EMAIL", signed([{ nope: true }]));
    expect(bad.httpStatus).toBe(400);
    const unknown = await handleProviderWebhook("EMAIL", signed([{ eventId: "eu", messageId: "ghost", type: "delivered" }]));
    expect(unknown.body).toMatchObject({ unmatched: 1 });
  });

  it("a bounce marks the message BOUNCED and suppresses the address; a complaint suppresses everything", async () => {
    const log = await sentSmsLog();
    await handleProviderWebhook("EMAIL", signed([{ eventId: "b1", messageId: "msg-1", type: "bounce" }]));
    expect(log.deliveryStatus).toBe("BOUNCED");
    expect(rows("communicationSuppression").some((s) => s.reason === "BOUNCE" && s.scope === "ALL")).toBe(true);
    expect((await canSend(intent())).blockedCode).toBe("BLOCKED_SUPPRESSED");
  });

  it("an unsubscribe suppresses MARKETING only", async () => {
    await sentSmsLog();
    await handleProviderWebhook("EMAIL", signed([{ eventId: "u1", messageId: "msg-1", type: "unsubscribe" }]));
    expect(rows("communicationSuppression").some((s) => s.reason === "UNSUBSCRIBED" && s.scope === "MARKETING")).toBe(true);
    expect((await canSend(intent())).allowed).toBe(true);
  });
});

describe("event dispatch: templates, rendering and contact-leak safety", () => {
  it("uses the built-in copy by default and never puts any contact detail in a message", async () => {
    rows("proposal").push({ id: "pr1", profileAId: "p1", profileBId: "p2", proposalCode: "PRP-2026-000001" });
    const results = await dispatchEventToExternalChannels({ profileId: "p1", type: "PROPOSAL_RECEIVED", language: "EN", relatedProposalId: "pr1", templateVars: { proposal_id: "PRP-2026-000001" } });
    expect(results.some((r) => r.status === "SENT")).toBe(true);
    for (const l of logs()) {
      const text = String(readableText(l.messageBody as string, l.bodyEncrypted as boolean, null));
      for (const secret of [PHONE_B, "p2@example.com", "+92300"]) expect(text, `${l.channel} body leaked ${secret}`).not.toContain(secret);
      expect(JSON.stringify(l)).not.toContain(PHONE_B);
    }
  });

  it("an ACTIVE bound template replaces the built-in copy and is recorded with its id and version", async () => {
    rows("communicationTemplate").push({ id: "t1", templateCode: "LPP-CTPL-000001", name: "Proposal mail", channel: "EMAIL", messageType: "PROPOSAL", purpose: "PROPOSAL", language: "EN", eventKey: "PROPOSAL_RECEIVED", subject: "New proposal for {{firstName}}", body: "Hello {{firstName}}, proposal {{proposalId}} is waiting.", status: "ACTIVE", currentVersion: 2, activeVersion: 2 });
    rows("proposal").push({ id: "pr1", profileAId: "p1", profileBId: "p2", proposalCode: "PRP-2026-000001" });
    await dispatchEventToExternalChannels({ profileId: "p1", type: "PROPOSAL_RECEIVED", language: "EN", relatedProposalId: "pr1" });
    const mail = logs().find((l) => l.channel === "EMAIL")!;
    expect(mail).toMatchObject({ templateId: "t1", templateVersion: 2 });
    expect(readableText(mail.messageBody as string, true, null)).toBe("Hello Person, proposal PRP-2026-000001 is waiting.");
  });

  it("a template that cannot be rendered safely falls back to the built-in copy instead of sending a broken message", async () => {
    rows("communicationTemplate").push({ id: "t2", templateCode: "LPP-CTPL-000002", name: "Broken", channel: "EMAIL", messageType: "PROPOSAL", purpose: "PROPOSAL", language: "EN", eventKey: "PROPOSAL_RECEIVED", subject: null, body: "Hi {{firstName}}, see https://evil.example/login", status: "ACTIVE", currentVersion: 1, activeVersion: 1 });
    await dispatchEventToExternalChannels({ profileId: "p1", type: "PROPOSAL_RECEIVED", language: "EN" });
    const mail = logs().find((l) => l.channel === "EMAIL")!;
    expect(mail.templateId ?? null).toBeNull();
    expect(String(readableText(mail.messageBody as string, true, null))).not.toContain("evil.example");
  });

  it("WhatsApp is only attempted when an APPROVED provider template is bound to the event", async () => {
    rows("contactInfo").find((c) => c.profileId === "p1")!.whatsappNumber = "+923009990001";
    rows("profile").find((p) => p.id === "p1")!.contact = { mobileNumber: PHONE_A, whatsappNumber: "+923009990001", email: "p1@example.com" };
    await dispatchEventToExternalChannels({ profileId: "p1", type: "ACCOUNT_REGISTERED", language: "EN" });
    expect(logs().some((l) => l.channel === "WHATSAPP")).toBe(false);
  });

  it("admin-composed messages go through the engine and cannot carry the other party's contact details", async () => {
    rows("proposal").push({ id: "pr1", profileAId: "p1", profileBId: "p2" });
    const ok = await sendAdminComposedMessage({ profileId: "p1", channel: "EMAIL", message: "We have an update for you.", adminId: "a1", permissions: ["communications:send"] });
    expect(ok.status).toBe("SENT");
    await expect(sendAdminComposedMessage({ profileId: "p1", proposalId: "pr1", channel: "EMAIL", message: `Their number is ${PHONE_B}`, adminId: "a1", permissions: ["communications:send"] })).rejects.toThrow(/contact/i);
    restrictions.set("p1", new Set(["COMMUNICATION_RESTRICTED"]));
    await expect(sendAdminComposedMessage({ profileId: "p1", channel: "EMAIL", message: "Hello", adminId: "a1", permissions: [] })).rejects.toThrow(/restricted/i);
  });
});

describe("templates: lifecycle and separation of duties", () => {
  const input = { name: "Welcome", channel: "EMAIL" as const, messageType: "TRANSACTIONAL" as const, purpose: "ACCOUNT" as const, language: "EN" as const, body: "Hello {{firstName}}" };

  it("rejects unknown / forbidden variables, injection, and off-allow-list links at creation", async () => {
    for (const body of ["Hello {{phone}}", "Hello {{nope}}", "{% if x %}", "Go to https://evil.example/x"]) await expect(createTemplate(admin(), { ...input, body })).rejects.toThrow();
  });

  it("nobody can approve a version they wrote; another person can; an external template then needs the STEP 19 gate to activate", async () => {
    const t = await createTemplate(admin({ id: "author" }), input);
    await submitTemplate(admin({ id: "author" }), t.id as string);
    await expect(approveTemplate(admin({ id: "author" }), t.id as string)).rejects.toThrow(/wrote/);
    await approveTemplate(admin({ id: "reviewer" }), t.id as string);
    gate = { requiresApproval: true, status: "ALREADY_PENDING", approvalCode: "APR-1", approvalRequestId: "ar1" };
    const pending = await activateTemplate(admin({ id: "reviewer" }), t.id as string);
    expect(pending).toMatchObject({ approvalRequired: true, approvalCode: "APR-1" });
    expect(rows("communicationTemplate")[0].status).toBe("APPROVED");
    gate = { requiresApproval: true, status: "READY_TO_EXECUTE", approvalCode: "APR-1", approvalRequestId: "ar1" };
    const live = await activateTemplate(admin({ id: "reviewer" }), t.id as string);
    expect(live).toMatchObject({ approvalRequired: false });
    expect(rows("communicationTemplate")[0]).toMatchObject({ status: "ACTIVE", activeVersion: 1 });
  });

  it("editing an ACTIVE template creates a new draft version and keeps the live one serving", async () => {
    const t = await createTemplate(admin({ id: "author" }), input);
    await submitTemplate(admin({ id: "author" }), t.id as string);
    await approveTemplate(admin({ id: "reviewer" }), t.id as string);
    await activateTemplate(admin({ id: "reviewer" }), t.id as string);
    await editTemplate(admin({ id: "author" }), t.id as string, { body: "Hi again {{firstName}}", changeReason: "Friendlier wording" });
    const row = rows("communicationTemplate")[0];
    expect(row).toMatchObject({ status: "ACTIVE", activeVersion: 1, currentVersion: 2, body: "Hello {{firstName}}" });
    expect(rows("communicationTemplateVersion")).toHaveLength(2);
  });

  it("a WhatsApp template cannot be activated before the provider has approved it", async () => {
    const t = await createTemplate(admin({ id: "author" }), { ...input, channel: "WHATSAPP" });
    await submitTemplate(admin({ id: "author" }), t.id as string);
    await approveTemplate(admin({ id: "reviewer" }), t.id as string);
    await expect(activateTemplate(admin({ id: "reviewer" }), t.id as string)).rejects.toThrow(/provider/i);
  });
});

describe("campaign guards", () => {
  it("never allows a sensitive trait or a non-allow-listed field in an audience", () => {
    for (const field of ["religion", "caste", "incomeRange", "mobileNumber", "email", "fullName"]) {
      expect(() => assertAudienceAllowed({ op: "AND", rules: [{ field, op: "eq", value: "x" }] }), field).toThrow();
    }
    expect(() => assertAudienceAllowed({ op: "AND", rules: [{ field: "city", op: "eq", value: "Lahore" }] })).not.toThrow();
  });

  it("the campaign's creator can never approve it", async () => {
    rows("communicationCampaign").push({ id: "c1", campaignCode: "LPP-CAMP-1", name: "x", status: "REVIEW", messageType: "TRANSACTIONAL", channel: "EMAIL", purpose: "FOLLOWUP", templateId: "t", audienceFilter: "{}", estimatedRecipients: 5, createdById: "creator" });
    await expect(approveCampaign(admin({ id: "creator" }), "c1")).rejects.toThrow(/creat/i);
  });
});

describe("conversations: no applicant-to-applicant chat, visibility and IDOR", () => {
  const staff = () => admin({ permissions: ["communications:view", "communications:send", "communications:logs:view"] });

  it("a thread has at most one applicant; a message is INTERNAL_ONLY unless staff choose otherwise; the applicant sees only public messages", async () => {
    const thread = await createThread(staff(), { type: "SUPPORT_THREAD", subject: "About your documents", profileId: "p1" });
    const members = rows("communicationThreadMember").filter((m) => m.threadId === thread.id);
    expect(members.filter((m) => m.memberType === "PROFILE")).toHaveLength(1);
    await postStaffMessage(staff(), thread.id as string, { body: "Internal: check the duplicate flag" });
    await postStaffMessage(staff(), thread.id as string, { body: "Please upload a clearer photo.", visibility: "PUBLIC_TO_USER" });
    expect(rows("communicationThreadMessage").map((m) => m.visibility)).toEqual(["INTERNAL_ONLY", "PUBLIC_TO_USER"]);
    const view = await getThreadForProfile("p1", thread.id as string);
    expect(view.messages).toHaveLength(1);
    expect(view.messages[0].body).toBe("Please upload a clearer photo.");
    expect(JSON.stringify(view)).not.toContain("duplicate flag");
    expect(String(rows("communicationThreadMessage")[0].body)).not.toContain("duplicate"); // encrypted at rest
  });

  it("another applicant gets a plain 404 for someone else's conversation, and cannot reply to it", async () => {
    const thread = await createThread(staff(), { type: "SUPPORT_THREAD", subject: "Private matter", profileId: "p1" });
    await expect(getThreadForProfile("p2", thread.id as string)).rejects.toThrow(/not found/i);
    await expect(postProfileMessage("p2", thread.id as string, "hello")).rejects.toThrow(/not found/i);
    expect(await listThreadsForProfile("p2")).toEqual([]);
    expect((await listThreadsForProfile("p1")).map((t) => t.id)).toEqual([thread.id]);
  });

  it("an applicant reply is stored encrypted and is limited in length; a closed thread refuses replies", async () => {
    const thread = await createThread(staff(), { type: "SUPPORT_THREAD", subject: "Help", profileId: "p1" });
    await postProfileMessage("p1", thread.id as string, "Thank you");
    expect(String(rows("communicationThreadMessage")[0].body)).not.toContain("Thank you");
    await expect(postProfileMessage("p1", thread.id as string, "x".repeat(2001))).rejects.toThrow();
    rows("communicationThread")[0].status = "CLOSED";
    await expect(postProfileMessage("p1", thread.id as string, "again")).rejects.toThrow(/cannot reply/i);
  });

  it("a message an applicant will see can contain neither a phone number nor the other party's details without the sensitive permission", async () => {
    const thread = await createThread(staff(), { type: "SUPPORT_THREAD", subject: "Contact", profileId: "p1" });
    await expect(postStaffMessage(staff(), thread.id as string, { body: "Call me on 0300 1234567", visibility: "PUBLIC_TO_USER" })).rejects.toThrow(/sensitive/i);
  });

  it("internal comments never reach an applicant, even if PUBLIC_TO_USER is requested", async () => {
    await addInternalComment(staff(), { resourceType: "PROFILE", resourceId: "p1", profileId: "p1", body: "Looks suspicious", visibility: "PUBLIC_TO_USER" });
    expect(rows("communicationThreadMessage")[0].visibility).toBe("INTERNAL_ONLY");
    expect(await listThreadsForProfile("p1")).toEqual([]);
    const internal = rows("communicationThread")[0];
    await expect(getThreadForProfile("p1", internal.id as string)).rejects.toThrow(/not found/i);
    const seen = await listStaffThreadMessages(staff(), internal.id as string);
    expect(seen.messages).toHaveLength(1);
  });

  it("family members see only threads about THEIR applicant while their access is active", async () => {
    families.set("f1", { applicantId: "p1" });
    const thread = await createThread(staff(), { type: "FAMILY_COORDINATION", subject: "Meeting plan", profileId: "p1", familyMemberIds: ["f1"] });
    await postStaffMessage(staff(), thread.id as string, { body: "The meeting is confirmed.", visibility: "PUBLIC_TO_USER" });
    expect((await getThreadForFamilyMember("f1", thread.id as string)).messages).toHaveLength(1);
    families.delete("f1"); // access revoked
    await expect(getThreadForFamilyMember("f1", thread.id as string)).rejects.toThrow(/not found/i);
    families.set("f2", { applicantId: "p2" });
    await expect(getThreadForFamilyMember("f2", thread.id as string)).rejects.toThrow(/not found/i);
    await expect(createThread(staff(), { type: "FAMILY_COORDINATION", subject: "Wrong family", profileId: "p1", familyMemberIds: ["f2"] })).rejects.toThrow(/own applicant/i);
  });
});

describe("retention and OTP", () => {
  it("redacts old message bodies only when a policy is active and no legal hold / open case applies", async () => {
    const old = new Date(Date.now() - 400 * 86_400_000);
    rows("communicationLog").push({ id: "old1", profileId: "p1", channel: "EMAIL", messageBody: "secret words", createdAt: old, deliveryStatus: "SENT" }, { id: "old2", profileId: "p2", channel: "EMAIL", messageBody: "held words", createdAt: old, deliveryStatus: "SENT" });
    expect((await sweepCommunicationData()).ran).toBe(false); // no policy: nothing is guessed, nothing deleted
    expect(rows("communicationLog").every((l) => l.messageBody)).toBe(true);
    rows("retentionPolicy").push({ id: "rp", category: "COMMUNICATION_RECORDS", retentionDays: 365, action: "ANONYMIZE", isActive: true });
    rows("dataHold").push({ id: "h1", profileId: "p2", active: true, status: "ACTIVE" });
    rows("case").push({ id: "c1", reporterProfileId: "nobody", status: "CLOSED" });
    await sweepCommunicationData();
    const l1 = rows("communicationLog").find((l) => l.id === "old1")!;
    expect(l1.messageBody).toBeNull();
    expect(l1.bodyRedactedAt).toBeInstanceOf(Date);
    expect(l1.deliveryStatus).toBe("SENT"); // metadata is kept
    // p2 is under a legal hold: its wording is untouched
    const l2 = rows("communicationLog").find((l) => l.id === "old2")!;
    expect(l2.messageBody).toBe("held words");
    expect(l2.bodyRedactedAt ?? null).toBeNull();
    // an open case also protects a profile's messages
    seedProfile("p3");
    rows("communicationLog").push({ id: "old3", profileId: "p3", channel: "EMAIL", messageBody: "case words", createdAt: old, deliveryStatus: "SENT" });
    rows("case").push({ id: "c2", reporterProfileId: "p3", status: "NEW" });
    const again = await sweepCommunicationData();
    expect(again.skippedOpenCase).toBeGreaterThanOrEqual(1);
    expect(rows("communicationLog").find((l) => l.id === "old3")!.messageBody).toBe("case words");
  });

  it("OTP delivery throws on failure and writes a status row that never contains the code", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    await expect(sendOneTimeCode({ channel: "SMS", to: "+923009990001", body: "Your code is 481516" })).rejects.toThrow();
    const r = await sendOneTimeCode({ channel: "EMAIL", to: "p1@example.com", body: "Your code is 481516", profileId: "p1" });
    expect(r.providerKey).toMatch(/^sandbox-/);
    const row = lastLog();
    expect(row.messageBody).toBeNull();
    expect(JSON.stringify(row)).not.toContain("481516");
    expect(JSON.stringify(audits)).not.toContain("481516");
  });

  it("in production the code is redacted from console output unless COMMUNICATION_DEBUG_OTP=true", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubEnv("APP_ENV", "production");
    await sendOneTimeCode({ channel: "EMAIL", to: "p1@example.com", body: "Your Life Partner Pro code is 481516. It expires soon." });
    expect(spy.mock.calls.flat().join(" ")).not.toContain("481516");
    vi.stubEnv("COMMUNICATION_DEBUG_OTP", "true");
    spy.mockClear();
    await sendOneTimeCode({ channel: "EMAIL", to: "p1@example.com", body: "Your Life Partner Pro code is 481516. It expires soon." });
    expect(spy.mock.calls.flat().join(" ")).toContain("481516");
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("COMMUNICATION_DEBUG_OTP", "");
  });
});

describe("secrets never leak", () => {
  it("no provider credential appears in audit entries, message rows or dead letters after failures", async () => {
    rows("contactInfo").find((c) => c.profileId === "p1")!.mobileNumber = "+923009990001";
    rows("profile").find((p) => p.id === "p1")!.contact = { mobileNumber: "+923009990001", whatsappNumber: null, email: "p1@example.com" };
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    await communicate({ intent: intent({ channel: "SMS" }), body: "x" });
    const everything = JSON.stringify([audits, rows("communicationLog"), rows("communicationDeliveryEvent")]);
    for (const secret of ["e2e-token", "e2e-secret-for-communication-tests", createHmac("sha256", "x").digest("hex").slice(0, 0) + "ACe2e:e2e-token"]) expect(everything).not.toContain(secret);
    expect(lastLog().failureReason).toBe("PROVIDER_AUTHENTICATION_FAILED");
  });
});

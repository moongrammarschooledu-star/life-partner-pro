import { beforeEach, describe, expect, it, vi } from "vitest";

// STEP 32 milestone 3 — detection, alerts, escalation and rule versions end to end over an in-memory database: events in → alerts out, no
// duplicates on a re-run, suppression after closing, alert lifecycle rules, escalation tiers, versioned rules with a second reviewer, and a
// dry run that writes nothing.

type Row = Record<string, unknown> & { id?: string };
const h = vi.hoisted(() => ({ fake: null as unknown as ReturnType<typeof import("@/test-utils/fake-prisma").createFakeDb> }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", async () => {
  const { createFakeDb } = await import("@/test-utils/fake-prisma");
  h.fake = createFakeDb({
    defaults: {
      socSettings: { version: 1, suppressionWindowMinutes: 240, escalateCriticalMinutes: 15, escalateHighMinutes: 60, escalateMediumMinutes: 480, sessionIdleMinutes: null, maxConcurrentSessions: null, stepUpForHighRisk: true, enforceMfaPrivileged: false, accessLogRetentionDays: 365, alertRetentionDays: 730, lastDetectionAt: null, lastDetectionSummary: null },
      socDetectionRule: { currentVersion: 1 },
      socRuleVersion: { status: "ACTIVE", reviewerId: null, reviewedAt: null },
      socAlert: { status: "NEW", occurrences: 1, escalationLevel: 0, acknowledgedAt: null, acknowledgedById: null, assignedToId: null, resolution: null, resolvedAt: null, resolvedById: null, escalatedAt: null },
    },
    unique: { socDetectionRule: ["key"] },
    nested: { socDetectionRule: ["versions", "socRuleVersion", "ruleId"], socAlert: ["events", "socAlertEvent", "alertId"] },
    relations: { socDetectionRule: { versions: ["socRuleVersion", "ruleId", "many"] }, socAlert: { events: ["socAlertEvent", "alertId", "many"] } },
  });
  return { prisma: h.fake.prisma };
});

const flags = new Set<string>();
const audits: Row[] = [];
const sent: Row[] = [];
const perms: Record<string, string[]> = {
  RESPONDER: ["soc:view", "soc:alerts:view", "soc:alerts:manage"],
  APPROVER: ["soc:view", "soc:alerts:view", "soc:containment:approve"],
  PLAIN: ["profile:view"],
};
let seq = 0;

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async (p: string) => `LPP-${p}-${String(++seq).padStart(6, "0")}`) }));
vi.mock("@/lib/ops/feature-flags", () => ({ isFeatureEnabled: vi.fn(async (k: string) => flags.has(k)) }));
vi.mock("@/lib/notifications/notification-service", () => ({ sendNotification: vi.fn(async (a: Row) => { sent.push(a); }) }));
vi.mock("@/lib/effective-permissions", () => ({ resolveEffectivePermissions: vi.fn(async (a: { role: string }) => perms[a.role] ?? []) }));

const detection = await import("./detection");
const alerts = await import("./alerts");
const escalation = await import("./escalation");
const rules = await import("./rule-service");
const settingsSvc = await import("./settings");
const tick = await import("./tick");

const rows = (t: string) => h.fake.rows(t);
const NOW = new Date("2026-10-09T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
let evId = 0;
const ev = (eventType: string, over: Row = {}) => rows("securityEvent").push({ id: `ev-${++evId}`, eventType, adminId: null, profileId: null, ipHash: null, subjectKey: null, outcome: null, meta: null, createdAt: ago(10), ...over });
const manager = { id: "mgr-1", permissions: ["soc:alerts:manage", "soc:alerts:view"] };
const actor2 = { id: "mgr-2", permissions: ["soc:alerts:manage", "soc:rules:manage"] };

beforeEach(() => {
  h.fake.reset();
  audits.length = 0;
  sent.length = 0;
  seq = 0;
  evId = 0;
  flags.clear();
  for (const f of ["soc.enabled", "soc.detection.enabled", "soc.escalation.enabled"]) flags.add(f);
  rows("adminUser").push({ id: "resp-1", role: "RESPONDER", customRoleId: null, active: true }, { id: "appr-1", role: "APPROVER", customRoleId: null, active: true }, { id: "plain-1", role: "PLAIN", customRoleId: null, active: true }, { id: "mgr-1", role: "RESPONDER", customRoleId: null, active: true }, { id: "mgr-2", role: "RESPONDER", customRoleId: null, active: true });
});

const burstOfFailedLogins = (n: number, subjectKey = "acct-hash-1", startMin = 25) => { for (let i = 0; i < n; i++) ev("LOGIN_FAILED", { subjectKey, ipHash: "net-1", createdAt: ago(startMin - i) }); };
const run = (over: Partial<Parameters<typeof detection.runDetection>[0]> = {}) => detection.runDetection({ trigger: "SCHEDULED", now: NOW, ...over });
const allAlerts = () => rows("socAlert");

describe("detection raises alerts from events", () => {
  it("does nothing while the switches are off", async () => {
    flags.delete("soc.detection.enabled");
    burstOfFailedLogins(12);
    expect(await run()).toMatchObject({ skipped: true });
    expect(allAlerts()).toHaveLength(0);
    flags.clear();
    expect(await run()).toMatchObject({ skipped: true });
  });

  it("raises one neutral alert for a burst, with a code, a source and evidence pointers", async () => {
    burstOfFailedLogins(9);
    const out = await run();
    expect(out).toMatchObject({ skipped: false, alertsCreated: 1, errors: [] });
    const [a] = allAlerts();
    expect(a).toMatchObject({ alertCode: "LPP-SEC-ALERT-000001", ruleKey: "auth.failed_logins", severity: "MEDIUM", status: "NEW", source: "SecurityEvent", affectedResource: "ACCOUNT:acct-hash-1" });
    expect(String(a.title)).toMatch(/^Suspicious activity detected/);
    expect(String(a.summary)).toBe("9 failed sign-ins within 30 minutes (threshold 8).");
    expect((a.evidenceRefs as unknown[]).length).toBeLessThanOrEqual(10);
    expect(audits.map((x) => x.action)).toEqual(expect.arrayContaining(["SOC_ALERT_CREATED", "SOC_DETECTION_RUN"]));
    expect(rows("socSettings")[0].lastDetectionAt).toEqual(NOW);
  });

  it("stays quiet below the threshold and for events outside the window", async () => {
    burstOfFailedLogins(7);
    for (let i = 0; i < 6; i++) ev("LOGIN_FAILED", { subjectKey: "acct-2", createdAt: ago(600 + i * 60) }); // spread out
    expect(await run()).toMatchObject({ alertsCreated: 0, findings: 0 });
  });

  it("running again changes nothing (no duplicate alert, no inflated count)", async () => {
    burstOfFailedLogins(9);
    await run();
    const again = await run({ now: new Date(NOW.getTime() + 60_000) });
    expect(again).toMatchObject({ alertsCreated: 0 });
    expect(allAlerts()).toHaveLength(1);
    expect(allAlerts()[0].occurrences).toBe(1);
  });

  it("new evidence on an open alert bumps it instead of creating another", async () => {
    burstOfFailedLogins(9);
    await run();
    for (let i = 0; i < 9; i++) ev("LOGIN_FAILED", { subjectKey: "acct-hash-1", ipHash: "net-1", createdAt: new Date(NOW.getTime() + (1 + i) * 30_000) });
    const later = new Date(NOW.getTime() + 20 * 60_000);
    expect(await run({ now: later })).toMatchObject({ alertsCreated: 0, alertsRepeated: 1 });
    expect(allAlerts()).toHaveLength(1);
    expect(allAlerts()[0].occurrences).toBe(2);
    expect(rows("socAlertEvent").some((e) => e.kind === "REPEAT")).toBe(true);
  });

  it("many accounts from one network raises a HIGH alert and tells the responders (not people without the permission)", async () => {
    for (let i = 0; i < 7; i++) ev("LOGIN_FAILED", { subjectKey: `acct-${i}`, ipHash: "net-9", createdAt: ago(40 - i) });
    await run();
    const a = allAlerts().find((x) => x.ruleKey === "auth.credential_stuffing")!;
    expect(a).toMatchObject({ severity: "HIGH", affectedResource: "NETWORK:net-9" });
    const recipients = sent.filter((s) => s.type === "SOC_ALERT").map((s) => s.adminId).sort();
    expect(recipients).toEqual(["mgr-1", "mgr-2", "resp-1"]);
    expect(sent.every((s) => JSON.stringify(s.data) === "{}")).toBe(true); // the notice carries no details
  });

  it("takes the webhook name from the event, never from raw bodies", async () => {
    for (let i = 0; i < 5; i++) ev("WEBHOOK_SIGNATURE_FAILURE", { subjectKey: "prov-hash", ipHash: "net-3", meta: JSON.stringify({ provider: "payments-stripe", reason: "BAD_SIGNATURE" }), createdAt: ago(20 - i) });
    await run();
    expect(allAlerts().find((x) => x.ruleKey === "webhook.signature_failures")).toMatchObject({ affectedResource: "WEBHOOK:payments-stripe", severity: "HIGH" });
  });

  it("reads failed backups and denied AI requests from their own tables", async () => {
    rows("backupRun").push({ id: "b1", status: "FAILED", startedAt: ago(120) });
    for (let i = 0; i < 10; i++) rows("aiRequest").push({ id: `ai-${i}`, status: "DENIED", actorAdminId: "adm-9", createdAt: ago(30 - i) });
    await run();
    expect(allAlerts().find((x) => x.ruleKey === "backup.failed")).toMatchObject({ severity: "CRITICAL", affectedResource: "SYSTEM:backup" });
    expect(allAlerts().find((x) => x.ruleKey === "ai.denied_burst")).toMatchObject({ affectedResource: "ADMIN:adm-9" });
  });

  it("the tick does nothing with the master switch off and never throws", async () => {
    flags.clear();
    expect(await tick.runSocTick(NOW)).toEqual({ detection: null, escalation: null });
  });
});

describe("alert lifecycle", () => {
  async function newAlert() {
    burstOfFailedLogins(9);
    await run();
    return allAlerts()[0].id as string;
  }

  it("walks NEW → ACKNOWLEDGED → INVESTIGATING → RESOLVED → CLOSED, recording who and when", async () => {
    const id = await newAlert();
    await alerts.changeAlertStatus(manager, id, "ACKNOWLEDGED");
    expect(allAlerts()[0]).toMatchObject({ status: "ACKNOWLEDGED", acknowledgedById: "mgr-1" });
    await alerts.changeAlertStatus(manager, id, "INVESTIGATING", "Looking at the sign-in pattern");
    await alerts.changeAlertStatus(manager, id, "RESOLVED", "Reset the account owner's password and confirmed with them.");
    expect(allAlerts()[0]).toMatchObject({ status: "RESOLVED", resolvedById: "mgr-1", resolution: "Reset the account owner's password and confirmed with them." });
    await alerts.changeAlertStatus(manager, id, "CLOSED");
    const history = rows("socAlertEvent").filter((e) => e.alertId === id && e.kind === "STATUS").map((e) => e.toStatus);
    expect(history).toEqual(["ACKNOWLEDGED", "INVESTIGATING", "RESOLVED", "CLOSED"]);
  });

  it("refuses skipped steps, a closed alert, and a resolution without a written reason", async () => {
    const id = await newAlert();
    await expect(alerts.changeAlertStatus(manager, id, "RESOLVED", "Done and dusted, truly.")).rejects.toMatchObject({ status: 409 });
    await alerts.changeAlertStatus(manager, id, "ACKNOWLEDGED");
    await alerts.changeAlertStatus(manager, id, "INVESTIGATING");
    await expect(alerts.changeAlertStatus(manager, id, "RESOLVED", "short")).rejects.toMatchObject({ status: 422 });
    await expect(alerts.changeAlertStatus(manager, id, "FALSE_POSITIVE")).rejects.toMatchObject({ status: 422 });
    await alerts.changeAlertStatus(manager, id, "FALSE_POSITIVE", "A scheduled load test from our own network.");
    await alerts.changeAlertStatus(manager, id, "CLOSED");
    await expect(alerts.changeAlertStatus(manager, id, "INVESTIGATING")).rejects.toMatchObject({ status: 409 });
    await expect(alerts.changeAlertStatus(manager, "nope", "ACKNOWLEDGED")).rejects.toMatchObject({ status: 404 });
  });

  it("only people who can work alerts can be assigned one", async () => {
    const id = await newAlert();
    await expect(alerts.assignAlert(manager, id, "plain-1")).rejects.toMatchObject({ status: 422 });
    await expect(alerts.assignAlert(manager, id, "ghost")).rejects.toMatchObject({ status: 422 });
    await alerts.assignAlert(manager, id, "resp-1");
    expect(allAlerts()[0].assignedToId).toBe("resp-1");
  });

  it("an alert that was handled is not raised again for the same evidence, and not again within the suppression window", async () => {
    const id = await newAlert();
    await alerts.changeAlertStatus(manager, id, "ACKNOWLEDGED");
    await alerts.changeAlertStatus(manager, id, "INVESTIGATING");
    await alerts.changeAlertStatus(manager, id, "RESOLVED", "Confirmed with the account owner; password reset.");
    allAlerts()[0].resolvedAt = NOW; // the handler resolved it at the simulated time (the service stamps the real clock)
    // same evidence re-read (e.g. an overlapping window): suppressed
    rows("socSettings")[0].lastDetectionAt = ago(60);
    expect(await run({ now: new Date(NOW.getTime() + 60_000) })).toMatchObject({ alertsCreated: 0, alertsSuppressed: 1 });
    // fresh events soon after closing: still inside the 240-minute suppression window
    for (let i = 0; i < 9; i++) ev("LOGIN_FAILED", { subjectKey: "acct-hash-1", ipHash: "net-1", createdAt: new Date(NOW.getTime() + (2 + i) * 60_000) });
    const soon = new Date(NOW.getTime() + 30 * 60_000);
    expect(await run({ now: soon })).toMatchObject({ alertsCreated: 0, alertsSuppressed: 1 });
    // fresh events after the window: a new alert
    for (let i = 0; i < 9; i++) ev("LOGIN_FAILED", { subjectKey: "acct-hash-1", ipHash: "net-1", createdAt: new Date(NOW.getTime() + 600 * 60_000 + i * 60_000) });
    const later = new Date(NOW.getTime() + 620 * 60_000);
    expect(await run({ now: later })).toMatchObject({ alertsCreated: 1 });
    expect(allAlerts()).toHaveLength(2);
  });
});

describe("escalation of unacknowledged alerts", () => {
  async function highAlert() {
    for (let i = 0; i < 7; i++) ev("LOGIN_FAILED", { subjectKey: `acct-${i}`, ipHash: "net-9", createdAt: ago(40 - i) });
    await run();
    sent.length = 0;
    return allAlerts().find((x) => x.ruleKey === "auth.credential_stuffing")!;
  }
  const settings = () => settingsSvc.getSocSettings();

  it("moves to level 1 after the HIGH limit (approvers told), then level 2 (everyone told)", async () => {
    const a = await highAlert();
    const t1 = new Date((a.createdAt as Date).getTime() + 61 * 60_000);
    expect(await escalation.runEscalation(await settings(), t1)).toMatchObject({ escalated: 1 });
    expect(allAlerts().find((x) => x.id === a.id)).toMatchObject({ status: "ESCALATED", escalationLevel: 1 });
    expect(sent.map((s) => s.adminId)).toEqual(["appr-1"]);
    sent.length = 0;
    const t2 = new Date((a.createdAt as Date).getTime() + 121 * 60_000);
    expect(await escalation.runEscalation(await settings(), t2)).toMatchObject({ escalated: 1 });
    expect(allAlerts().find((x) => x.id === a.id)).toMatchObject({ escalationLevel: 2 });
    expect([...new Set(sent.map((s) => s.adminId))].sort()).toEqual(["appr-1", "mgr-1", "mgr-2", "resp-1"]);
    expect(await escalation.runEscalation(await settings(), new Date(t2.getTime() + 86_400_000))).toMatchObject({ escalated: 0 });
    expect(audits.filter((x) => x.action === "SOC_ALERT_ESCALATED")).toHaveLength(2);
    expect(rows("socAlertEvent").filter((e) => e.kind === "ESCALATE")).toHaveLength(2);
  });

  it("does not escalate once someone acknowledges, or when the switch is off", async () => {
    const a = await highAlert();
    flags.delete("soc.escalation.enabled");
    const late = new Date((a.createdAt as Date).getTime() + 500 * 60_000);
    expect(await escalation.runEscalation(await settings(), late)).toMatchObject({ escalated: 0, examined: 0 });
    flags.add("soc.escalation.enabled");
    await alerts.changeAlertStatus(manager, a.id as string, "ACKNOWLEDGED");
    expect(await escalation.runEscalation(await settings(), late)).toMatchObject({ escalated: 0 });
  });

  it("a manual escalation tells the approvers and is recorded", async () => {
    const a = await highAlert();
    await alerts.changeAlertStatus(manager, a.id as string, "ESCALATED");
    expect(sent.map((s) => s.adminId)).toEqual(["appr-1"]);
    expect(allAlerts().find((x) => x.id === a.id)).toMatchObject({ status: "ESCALATED", escalationLevel: 1 });
  });
});

describe("versioned rules", () => {
  it("version 1 is the shipped default, created on first use", async () => {
    const list = await rules.listRules();
    expect(list.length).toBeGreaterThanOrEqual(15);
    expect(list.find((r) => r.key === "auth.failed_logins")).toMatchObject({ active: { version: 1, threshold: 8, windowMinutes: 30, severity: "MEDIUM" }, proposed: null });
    await rules.listRules(); // idempotent
    expect(rows("socDetectionRule")).toHaveLength(list.length);
  });

  it("strengthening takes effect at once; the detection run uses the new threshold", async () => {
    await rules.ensureRules();
    const r = await rules.proposeRuleChange(manager, "auth.failed_logins", { threshold: 4 }, "Tighten while we are being probed");
    expect(r).toEqual({ status: "ACTIVE", version: 2 });
    burstOfFailedLogins(5);
    expect(await run()).toMatchObject({ alertsCreated: 1 });
    expect((await rules.ruleHistory("auth.failed_logins")).map((v) => `${v.version}:${v.status}`).sort()).toEqual(["1:SUPERSEDED", "2:ACTIVE"]);
  });

  it("weakening a protected rule waits for a different person and changes nothing until approved", async () => {
    await rules.ensureRules();
    const p = await rules.proposeRuleChange(manager, "data.bulk_exports", { threshold: 20 }, "Too noisy during the month-end reports");
    expect(p).toEqual({ status: "PROPOSED", version: 2 });
    expect((await rules.activeConfigs()).get("data.bulk_exports")).toMatchObject({ threshold: 5, version: 1 });
    await expect(rules.proposeRuleChange(manager, "data.bulk_exports", { threshold: 30 }, "Another change")).rejects.toMatchObject({ status: 409 });
    await expect(rules.reviewRuleChange(manager, "data.bulk_exports", "APPROVE", "I approve my own change")).rejects.toMatchObject({ status: 403 });
    expect(await rules.reviewRuleChange(actor2, "data.bulk_exports", "APPROVE", "Agreed: month-end is expected")).toEqual({ status: "ACTIVE", version: 2 });
    expect((await rules.activeConfigs()).get("data.bulk_exports")).toMatchObject({ threshold: 20, version: 2 });
    const v = await rules.ruleHistory("data.bulk_exports");
    expect(v.find((x) => x.version === 2)).toMatchObject({ authorId: "mgr-1", reviewerId: "mgr-2" });
  });

  it("a rejected weakening leaves the active version alone", async () => {
    await rules.ensureRules();
    await rules.proposeRuleChange(manager, "admin.break_glass_use", { enabled: false }, "We never use it, switch it off");
    expect(await rules.reviewRuleChange(actor2, "admin.break_glass_use", "REJECT", "Break-glass use must always be reviewed")).toEqual({ status: "REJECTED", version: 2 });
    expect((await rules.activeConfigs()).get("admin.break_glass_use")).toMatchObject({ enabled: true, version: 1 });
  });

  it("requires a reason, valid values and a real change", async () => {
    await rules.ensureRules();
    await expect(rules.proposeRuleChange(manager, "auth.failed_logins", { threshold: 3 }, "x")).rejects.toMatchObject({ status: 422 });
    await expect(rules.proposeRuleChange(manager, "auth.failed_logins", { threshold: 0 }, "Valid reason here")).rejects.toMatchObject({ status: 422 });
    await expect(rules.proposeRuleChange(manager, "auth.failed_logins", {}, "Valid reason here")).rejects.toMatchObject({ status: 422 });
    await expect(rules.proposeRuleChange(manager, "no.such.rule", { threshold: 3 }, "Valid reason here")).rejects.toMatchObject({ status: 404 });
  });

  it("a switched-off rule raises nothing", async () => {
    await rules.ensureRules();
    await rules.proposeRuleChange(manager, "auth.otp_failures", { enabled: false }, "Not using one-time codes right now");
    for (let i = 0; i < 9; i++) ev("OTP_FAILED", { subjectKey: "acct-otp", createdAt: ago(20 - i) });
    // OTP rule is MEDIUM and unprotected → the switch-off is immediate
    expect((await rules.activeConfigs()).get("auth.otp_failures")?.enabled).toBe(false);
    await run();
    expect(allAlerts().filter((x) => x.ruleKey === "auth.otp_failures")).toHaveLength(0);
  });
});

describe("dry run", () => {
  it("shows what a configuration would have raised and writes no alerts", async () => {
    burstOfFailedLogins(6); // below the live threshold of 8
    await rules.ensureRules();
    const live = await rules.dryRunRule(manager, "auth.failed_logins", { now: NOW });
    expect(live.findings).toBe(0);
    const tighter = await rules.dryRunRule(manager, "auth.failed_logins", { now: NOW, config: { threshold: 5 } });
    expect(tighter).toMatchObject({ findings: 1, config: { threshold: 5 } });
    expect(tighter.sample[0].summary).toBe("6 failed sign-ins within 30 minutes (threshold 5).");
    expect(allAlerts()).toHaveLength(0);
    expect((await rules.activeConfigs()).get("auth.failed_logins")?.threshold).toBe(8); // nothing was changed
    expect(audits.filter((a) => a.action === "SOC_RULE_DRY_RUN")).toHaveLength(2);
  });

  it("even a switched-off rule can be tried, and bad input is refused", async () => {
    await rules.ensureRules();
    await expect(rules.dryRunRule(manager, "nope", { now: NOW })).rejects.toMatchObject({ status: 404 });
    await expect(rules.dryRunRule(manager, "auth.failed_logins", { now: NOW, config: { threshold: -1 } })).rejects.toMatchObject({ status: 422 });
  });
});

describe("security configuration changes", () => {
  it("writes an immutable version row, an audit entry and a security event, and needs a reason", async () => {
    await expect(settingsSvc.updateSocSettings("mgr-1", { sessionIdleMinutes: 30 }, "x")).rejects.toMatchObject({ status: 422 });
    const s = await settingsSvc.updateSocSettings("mgr-1", { sessionIdleMinutes: 30, escalateHighMinutes: 45 }, "Shorten idle sessions; faster HIGH escalation");
    expect(s).toMatchObject({ version: 2, sessionIdleMinutes: 30, escalateHighMinutes: 45 });
    const [v] = await settingsSvc.listConfigVersions();
    expect(v).toMatchObject({ version: 2, authorId: "mgr-1" });
    expect(v.changes).toEqual({ sessionIdleMinutes: { from: null, to: 30 }, escalateHighMinutes: { from: 60, to: 45 } });
    expect(audits.some((a) => a.action === "SOC_CONFIG_CHANGED")).toBe(true);
    await expect(settingsSvc.updateSocSettings("mgr-1", { sessionIdleMinutes: 30 }, "Same value again")).rejects.toMatchObject({ status: 422 });
    await expect(settingsSvc.updateSocSettings("mgr-1", { sessionIdleMinutes: 2 }, "Out of range value")).rejects.toMatchObject({ status: 422 });
  });
});

describe("the audit trail never carries secrets", () => {
  it("scrubs passwords, tokens and keys out of an audit entry before it is written", async () => {
    const { socAudit } = await import("./audit");
    audits.length = 0;
    await socAudit({ action: "SOC_CONFIG_CHANGED", actorId: "mgr-1", resource: "settings", resourceId: "2", after: { password: "hunter2-hunter2", apiKey: ["sk", "live", "abcdef0123456789"].join("_"), token: "abc.def.ghi", note: "shorter idle timeout" }, reason: "Tightening sessions" });
    expect(audits).toHaveLength(1);
    const meta = JSON.stringify(audits[0].meta);
    expect(meta).not.toMatch(/hunter2|sk_live_abcdef|abc\.def\.ghi/);
    expect(meta).toContain("shorter idle timeout");
  });
});

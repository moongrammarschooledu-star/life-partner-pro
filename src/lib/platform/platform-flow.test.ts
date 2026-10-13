import { beforeEach, describe, expect, it, vi } from "vitest";

// STEP 36 — the Control Center services end to end over an in-memory database: settings (typed, versioned, environment-named), the change freeze and
// break-glass, feature flags (including the approval rule for sensitive flags), rollback (abuse refused), announcements and the provider view (no secret leaks).

type Row = Record<string, unknown> & { id?: string };
const h = vi.hoisted(() => ({ fake: null as unknown as ReturnType<typeof import("@/test-utils/fake-prisma").createFakeDb> }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { createFakeDb } = await import("@/test-utils/fake-prisma");
  h.fake = createFakeDb({
    defaults: { platformChangeFreeze: { endedAt: null, endedById: null, endsAt: null }, platformBreakGlassEvent: { endedAt: null, actionsCount: 0, reviewedAt: null, reviewedById: null, reviewNote: null }, platformAnnouncement: { status: "DRAFT", resolvedAt: null, showOnStatusPage: false, startsAt: null, endsAt: null } },
    unique: { platformSetting: ["key"], featureFlag: ["key"] },
  });
  return { prisma: h.fake.prisma };
});

const audits: Row[] = [];
const gateCalls: Row[] = [];
let gateRequiresApproval = false;
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/ops/feature-flags", () => ({ invalidateFeatureFlags: vi.fn() }));
vi.mock("@/lib/approvals/gate", () => ({
  enforceApprovalGate: vi.fn(async (p: Row) => {
    gateCalls.push(p);
    return gateRequiresApproval ? { requiresApproval: true, status: "ALREADY_PENDING", approvalRequestId: "ar1", approvalCode: "LPP-APR-000001" } : { requiresApproval: false };
  }),
  markApprovalExecuted: vi.fn(),
}));
vi.mock("@/lib/ops/health", () => ({
  getHealthReport: vi.fn(async () => ({ status: "ok", checks: { database: { status: "ok" }, storage: { status: "ok" }, authentication: { status: "ok" } } })),
  checkDatabase: vi.fn(async () => ({ status: "ok", latencyMs: 1 })),
}));
vi.mock("@/lib/communications/providers/registry", () => ({ buildAdapter: vi.fn(() => null) }));
vi.mock("@/lib/communications/provider-service", () => ({ ADAPTER_SECRET_NAMES: {}, probeProvider: vi.fn() }));

const settings = await import("./settings");
const flags = await import("./flags");
const rollback = await import("./rollback");
const freeze = await import("./freeze");
const breakGlass = await import("./break-glass");
const announcements = await import("./announcements");
const providers = await import("./providers");
const changeLog = await import("./config-change");

type Admin = { id: string; role: string; permissions: string[]; sid?: string };
const ALL = ["platform:settings:manage", "platform:branding:manage", "platform:features:manage", "platform:configuration:rollback", "platform:change_freeze", "platform:break_glass", "platform:announcements:manage", "platform:providers:manage"];
const superAdmin: Admin = { id: "sa1", role: "SUPER_ADMIN", permissions: ALL };
const other: Admin = { id: "sa2", role: "SUPER_ADMIN", permissions: ALL };
const viewer: Admin = { id: "v1", role: "OPERATIONS_ADMIN", permissions: ["platform:settings:view"] };
const ENV = "PRODUCTION";
const rows = (t: string) => h.fake.rows(t);
const change = (a: Admin, key: string, value: unknown, extra: Record<string, unknown> = {}) => settings.setPlatformSetting(a as never, { key, value, reason: "testing a change", environment: ENV, ...extra });

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "production");
  for (const t of ["platformSetting", "featureFlag", "platformConfigChange", "platformChangeFreeze", "platformBreakGlassEvent", "platformAnnouncement", "platformProviderCheck"]) rows(t).length = 0;
  audits.length = 0;
  gateCalls.length = 0;
  gateRequiresApproval = false;
});

describe("platform settings", () => {
  it("saves a value as a new version, logs before and after, and audits", async () => {
    const r = await change(superAdmin, "platform.name", "Life Partner Pro Plus");
    expect(r).toMatchObject({ approvalRequired: false, version: 1, value: "Life Partner Pro Plus" });
    const log = rows("platformConfigChange");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: "SETTING", key: "platform.name", version: 1, before: "Life Partner Pro", after: "Life Partner Pro Plus", actorId: "sa1", environment: "PRODUCTION" });
    expect(audits.map((a) => a.action)).toContain("PLATFORM_SETTING_CHANGED");
    const second = await change(superAdmin, "platform.name", "Another Name");
    expect(second).toMatchObject({ version: 2 });
    expect(rows("platformConfigChange")).toHaveLength(2);
  });

  it("refuses without the permission, without naming the environment, or for the wrong one", async () => {
    await expect(change(viewer, "platform.name", "X Name")).rejects.toMatchObject({ status: 403 });
    await expect(settings.setPlatformSetting(superAdmin as never, { key: "platform.name", value: "X Name", reason: "testing a change", environment: undefined })).rejects.toMatchObject({ status: 400 });
    await expect(settings.setPlatformSetting(superAdmin as never, { key: "platform.name", value: "X Name", reason: "testing a change", environment: "STAGING" })).rejects.toMatchObject({ status: 409 });
    expect(rows("platformSetting")).toHaveLength(0);
  });

  it("refuses an invalid value, a secret-looking value, an unknown key and a missing reason", async () => {
    await expect(change(superAdmin, "status.page_enabled", "yes")).rejects.toMatchObject({ status: 400 });
    await expect(change(superAdmin, "platform.tagline", "sk_live_abcdefghijklmnop")).rejects.toMatchObject({ status: 400 });
    await expect(change(superAdmin, "payment.provider", "x")).rejects.toMatchObject({ status: 400 });
    await expect(settings.setPlatformSetting(superAdmin as never, { key: "platform.name", value: "X Name", reason: "no", environment: ENV })).rejects.toMatchObject({ status: 400 });
    expect(rows("platformConfigChange")).toHaveLength(0);
  });

  it("refuses to save the value it already has", async () => {
    await expect(change(superAdmin, "platform.name", "Life Partner Pro")).rejects.toMatchObject({ status: 409 });
  });

  it("branding needs the branding permission, not the settings permission", async () => {
    const onlySettings: Admin = { id: "s", role: "OPERATIONS_ADMIN", permissions: ["platform:settings:manage"] };
    await expect(change(onlySettings, "branding.primary_colour", "#112233")).rejects.toMatchObject({ status: 403 });
    await expect(change(superAdmin, "branding.primary_colour", "#112233")).resolves.toMatchObject({ version: 1 });
  });
});

describe("change freeze and break-glass", () => {
  it("a freeze blocks changes (423); ending it restores them", async () => {
    await freeze.startFreeze(superAdmin as never, { reason: "release week", environment: ENV });
    await expect(change(superAdmin, "platform.name", "Blocked Name")).rejects.toMatchObject({ status: 423 });
    await freeze.endFreeze(superAdmin as never, { reason: "release finished", environment: ENV });
    await expect(change(superAdmin, "platform.name", "Allowed Name")).resolves.toMatchObject({ version: 1 });
    expect(audits.filter((a) => a.action === "PLATFORM_CHANGE_FREEZE_CHANGED")).toHaveLength(2);
  });

  it("break-glass lets one named administrator through, counts the use, and never changes their role", async () => {
    await freeze.startFreeze(superAdmin as never, { reason: "release week", environment: ENV });
    const noBg = other;
    await expect(change(noBg, "platform.name", "Blocked Name")).rejects.toMatchObject({ status: 423 });
    await breakGlass.grantBreakGlass(superAdmin as never, { reason: "urgent fix for the contact details", minutes: 10, environment: ENV });
    await expect(change(superAdmin, "platform.name", "Fixed Name")).resolves.toMatchObject({ version: 1 });
    expect(rows("platformBreakGlassEvent")[0].actionsCount).toBe(1);
    expect(superAdmin.role).toBe("SUPER_ADMIN");
    expect(superAdmin.permissions).toEqual(ALL);
    // someone else is still blocked
    await expect(change(other, "platform.short_name", "Other Name")).rejects.toMatchObject({ status: 423 });
    await breakGlass.endBreakGlass(superAdmin as never);
    await expect(change(superAdmin, "platform.tagline", "Another tagline here")).rejects.toMatchObject({ status: 423 });
  });

  it("break-glass is only available during a freeze and needs a real reason", async () => {
    await expect(breakGlass.grantBreakGlass(superAdmin as never, { reason: "urgent fix for the contact details", environment: ENV })).rejects.toMatchObject({ status: 409 });
    await freeze.startFreeze(superAdmin as never, { reason: "release week", environment: ENV });
    await expect(breakGlass.grantBreakGlass(superAdmin as never, { reason: "short", environment: ENV })).rejects.toMatchObject({ status: 400 });
  });

  it("an expired break-glass no longer lets changes through", async () => {
    await freeze.startFreeze(superAdmin as never, { reason: "release week", environment: ENV });
    await breakGlass.grantBreakGlass(superAdmin as never, { reason: "urgent fix for the contact details", minutes: 10, environment: ENV });
    rows("platformBreakGlassEvent")[0].expiresAt = new Date(Date.now() - 1000);
    await expect(change(superAdmin, "platform.name", "Late Name")).rejects.toMatchObject({ status: 423 });
  });

  it("a different administrator reviews it, once, after it has ended", async () => {
    await freeze.startFreeze(superAdmin as never, { reason: "release week", environment: ENV });
    const ev = await breakGlass.grantBreakGlass(superAdmin as never, { reason: "urgent fix for the contact details", environment: ENV });
    await expect(breakGlass.reviewBreakGlass(other as never, ev.id, "looked fine to me")).rejects.toMatchObject({ status: 409 }); // still active
    await breakGlass.endBreakGlass(superAdmin as never);
    await expect(breakGlass.reviewBreakGlass(superAdmin as never, ev.id, "reviewing myself")).rejects.toMatchObject({ status: 403 });
    await breakGlass.reviewBreakGlass(other as never, ev.id, "looked fine to me");
    await expect(breakGlass.reviewBreakGlass(other as never, ev.id, "again please")).rejects.toMatchObject({ status: 409 });
  });

  it("a freeze needs a future end time of at most 30 days and only one at a time", async () => {
    await expect(freeze.startFreeze(superAdmin as never, { reason: "release week", endsAt: new Date(Date.now() - 1000).toISOString(), environment: ENV })).rejects.toMatchObject({ status: 400 });
    await expect(freeze.startFreeze(superAdmin as never, { reason: "release week", endsAt: new Date(Date.now() + 40 * 86_400_000).toISOString(), environment: ENV })).rejects.toMatchObject({ status: 400 });
    await freeze.startFreeze(superAdmin as never, { reason: "release week", environment: ENV });
    await expect(freeze.startFreeze(superAdmin as never, { reason: "again", environment: ENV })).rejects.toMatchObject({ status: 409 });
  });
});

describe("feature flags", () => {
  it("switching a flag off is immediate; the change is logged with before and after", async () => {
    const r = await flags.applyFlagChange(superAdmin as never, { key: "matching.enabled", state: "DISABLED", reason: "pausing matching", environment: ENV });
    expect(r).toMatchObject({ approvalRequired: false, state: "DISABLED", version: 1 });
    expect(rows("featureFlag")[0]).toMatchObject({ key: "matching.enabled", state: "DISABLED", enabled: false });
    expect(rows("platformConfigChange")[0]).toMatchObject({ kind: "FEATURE_FLAG", key: "matching.enabled" });
    expect(gateCalls).toHaveLength(0);
  });

  it("enabling a SENSITIVE flag in production goes through the approval gate and is held when approval is needed", async () => {
    await flags.applyFlagChange(superAdmin as never, { key: "matching.enabled", state: "DISABLED", reason: "pausing matching", environment: ENV });
    gateRequiresApproval = true;
    const r = await flags.applyFlagChange(superAdmin as never, { key: "matching.enabled", state: "ENABLED", reason: "turn it back on", environment: ENV });
    expect(r).toMatchObject({ approvalRequired: true, approvalCode: "LPP-APR-000001" });
    expect(gateCalls[0]).toMatchObject({ actionType: "PLATFORM_FEATURE_ACTIVATION", sourceType: "PLATFORM_CONFIG" });
    expect(rows("featureFlag")[0].state).toBe("DISABLED"); // unchanged until approved
  });

  it("without a policy requiring approval the activation applies", async () => {
    await flags.applyFlagChange(superAdmin as never, { key: "matching.enabled", state: "DISABLED", reason: "pausing matching", environment: ENV });
    const r = await flags.applyFlagChange(superAdmin as never, { key: "matching.enabled", state: "ENABLED", reason: "turn it back on", environment: ENV });
    expect(r).toMatchObject({ approvalRequired: false, state: "ENABLED" });
  });

  it("validates the rule, the key, the permission and the environment", async () => {
    const base = { reason: "testing a change", environment: ENV };
    await expect(flags.applyFlagChange(superAdmin as never, { key: "nope.enabled", state: "DISABLED", ...base })).rejects.toMatchObject({ status: 400 });
    await expect(flags.applyFlagChange(superAdmin as never, { key: "matching.enabled", state: "ROLLOUT", ...base })).rejects.toMatchObject({ status: 400 });
    await expect(flags.applyFlagChange(superAdmin as never, { key: "matching.enabled", state: "ROLLOUT", targets: [{ type: "RELIGION", values: ["x"] }], ...base })).rejects.toMatchObject({ status: 400 });
    await expect(flags.applyFlagChange(viewer as never, { key: "matching.enabled", state: "DISABLED", ...base })).rejects.toMatchObject({ status: 403 });
    await expect(flags.applyFlagChange(superAdmin as never, { key: "matching.enabled", state: "DISABLED", reason: "testing a change", environment: "STAGING" })).rejects.toMatchObject({ status: 409 });
    await expect(flags.applyFlagChange(superAdmin as never, { key: "matching.enabled", state: "ENABLED", ...base })).rejects.toMatchObject({ status: 409 }); // already enabled by default
  });

  it("during a freeze an emergency switch-off by a freeze holder goes through but enabling does not", async () => {
    await freeze.startFreeze(superAdmin as never, { reason: "release week", environment: ENV });
    const holder: Admin = { id: "h", role: "SUPER_ADMIN", permissions: ["platform:features:manage", "platform:change_freeze"] };
    await expect(flags.applyFlagChange(holder as never, { key: "matching.enabled", state: "EMERGENCY_DISABLED", reason: "incident response", environment: ENV })).resolves.toMatchObject({ state: "EMERGENCY_DISABLED" });
    await expect(flags.applyFlagChange(holder as never, { key: "matching.enabled", state: "ENABLED", reason: "turning back on", environment: ENV })).rejects.toMatchObject({ status: 423 });
    const noHolder: Admin = { id: "n", role: "SUPER_ADMIN", permissions: ["platform:features:manage"] };
    await expect(flags.applyFlagChange(noHolder as never, { key: "proposals.enabled", state: "DISABLED", reason: "incident response", environment: ENV })).rejects.toMatchObject({ status: 423 });
  });

  it("a rollout stores its percentage and targets and lists them back", async () => {
    await flags.applyFlagChange(superAdmin as never, { key: "ai.enabled", state: "ROLLOUT", rolloutPercent: 25, targets: [{ type: "ADMIN_ONLY" }], reason: "trial with staff", environment: ENV });
    const view = (await flags.listFlagViews()).find((f) => f.key === "ai.enabled")!;
    expect(view).toMatchObject({ state: "ROLLOUT", rolloutPercent: 25, version: 1 });
    expect(view.targets).toEqual([{ type: "ADMIN_ONLY", values: [] }]);
  });
});

describe("rollback", () => {
  it("restores the previous value as a NEW version and keeps the history", async () => {
    await change(superAdmin, "platform.name", "Name One");
    await change(superAdmin, "platform.name", "Name Two");
    const latest = rows("platformConfigChange").find((c) => c.version === 2)!;
    const r = await rollback.rollbackConfigChange(superAdmin as never, { changeId: latest.id, reason: "that name was wrong", environment: ENV });
    expect(r).toMatchObject({ approvalRequired: false, key: "platform.name", version: 3 });
    expect((await settings.getPlatformSettings()).find((s) => s.def.key === "platform.name")?.value).toBe("Name One");
    const log = rows("platformConfigChange");
    expect(log).toHaveLength(3);
    expect(log.find((c) => c.version === 3)).toMatchObject({ rolledBackFromId: latest.id });
    expect(audits.map((a) => a.action)).toContain("PLATFORM_CONFIG_ROLLED_BACK");
  });

  it("refuses to roll back an older change over a newer one, and refuses twice", async () => {
    await change(superAdmin, "platform.name", "Name One");
    await change(superAdmin, "platform.name", "Name Two");
    const v1 = rows("platformConfigChange").find((c) => c.version === 1)!;
    const v2 = rows("platformConfigChange").find((c) => c.version === 2)!;
    await expect(rollback.rollbackConfigChange(superAdmin as never, { changeId: v1.id, reason: "undo the first one", environment: ENV })).rejects.toMatchObject({ status: 409 });
    await rollback.rollbackConfigChange(superAdmin as never, { changeId: v2.id, reason: "undo the second one", environment: ENV });
    await expect(rollback.rollbackConfigChange(superAdmin as never, { changeId: v2.id, reason: "undo it again please", environment: ENV })).rejects.toMatchObject({ status: 409 });
  });

  it("needs the rollback permission, the right environment, a reason, and a supported kind", async () => {
    await change(superAdmin, "platform.name", "Name One");
    await change(superAdmin, "platform.name", "Name Two");
    const v2 = rows("platformConfigChange").find((c) => c.version === 2)!;
    const noRoll: Admin = { id: "n", role: "SUPER_ADMIN", permissions: ["platform:settings:manage"] };
    await expect(rollback.rollbackConfigChange(noRoll as never, { changeId: v2.id, reason: "undo the second one", environment: ENV })).rejects.toMatchObject({ status: 403 });
    await expect(rollback.rollbackConfigChange(superAdmin as never, { changeId: v2.id, reason: "undo the second one", environment: "STAGING" })).rejects.toMatchObject({ status: 409 });
    await expect(rollback.rollbackConfigChange(superAdmin as never, { changeId: v2.id, reason: "no", environment: ENV })).rejects.toMatchObject({ status: 400 });
    await expect(rollback.rollbackConfigChange(superAdmin as never, { changeId: "does-not-exist", reason: "undo the second one", environment: ENV })).rejects.toMatchObject({ status: 404 });
    await freeze.startFreeze(superAdmin as never, { reason: "release week", environment: ENV });
    const freezeChange = rows("platformConfigChange").find((c) => c.kind === "CHANGE_FREEZE")!;
    await expect(rollback.rollbackConfigChange(superAdmin as never, { changeId: freezeChange.id, reason: "undo the freeze", environment: ENV })).rejects.toMatchObject({ status: 400 });
    // and a rollback is itself blocked by a freeze
    await expect(rollback.rollbackConfigChange(superAdmin as never, { changeId: v2.id, reason: "undo the second one", environment: ENV })).rejects.toMatchObject({ status: 423 });
  });

  it("rolls a feature flag back only while it is still as that change left it", async () => {
    await flags.applyFlagChange(superAdmin as never, { key: "ai.enabled", state: "ROLLOUT", rolloutPercent: 10, reason: "trial begins", environment: ENV });
    await flags.applyFlagChange(superAdmin as never, { key: "ai.enabled", state: "ROLLOUT", rolloutPercent: 50, reason: "widening the trial", environment: ENV });
    const v2 = rows("platformConfigChange").find((c) => c.key === "ai.enabled" && c.version === 2)!;
    await rollback.rollbackConfigChange(superAdmin as never, { changeId: v2.id, reason: "back to ten percent", environment: ENV });
    expect((await flags.listFlagViews()).find((f) => f.key === "ai.enabled")?.rolloutPercent).toBe(10);
  });
});

describe("the change log", () => {
  it("never stores a secret-shaped key or value, and lists newest first with a cursor", async () => {
    await changeLog.recordConfigChange({ kind: "PROVIDER", key: "comm:x", before: { apiKey: "old-secret" }, after: { apiKey: "sk_live_abcdefghijklmnop", note: "ok" }, actor: { id: "sa1" }, reason: "rotating", environment: "PRODUCTION" });
    const row = rows("platformConfigChange")[0];
    expect(JSON.stringify(row)).not.toContain("old-secret");
    expect(JSON.stringify(row)).not.toContain("sk_live");
    for (let i = 0; i < 3; i++) await changeLog.recordConfigChange({ kind: "SETTING", key: `k${i}`, before: null, after: i, actor: null, environment: "PRODUCTION" });
    const page = await changeLog.listConfigChanges({ limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeTruthy();
    const next = await changeLog.listConfigChanges({ limit: 2, after: page.nextCursor! });
    expect(next.items.length).toBeGreaterThan(0);
  });
});

describe("announcements", () => {
  const input = (o: Record<string, unknown> = {}) => ({ kind: "MAINTENANCE", title: "Planned break", body: "The site will be unavailable on Sunday from 2 to 4 pm.", audience: ["ALL"], showOnStatusPage: true, ...o });

  it("refuses public text with internal detail, and an unknown audience, and needs the permission", async () => {
    await expect(announcements.createAnnouncement(superAdmin as never, input({ body: "Database 10.0.0.5 will be restarted" }))).rejects.toMatchObject({ status: 422 });
    await expect(announcements.createAnnouncement(superAdmin as never, input({ audience: ["EVERYONE"] }))).rejects.toMatchObject({ status: 400 });
    await expect(announcements.createAnnouncement(viewer as never, input())).rejects.toMatchObject({ status: 403 });
    expect(rows("platformAnnouncement")).toHaveLength(0);
  });

  it("is a draft until published, shows only to its audience, and stops when ended", async () => {
    const a = await announcements.createAnnouncement(superAdmin as never, input({ audience: ["APPLICANTS"], showOnStatusPage: false }));
    expect(a.status).toBe("DRAFT");
    expect(await announcements.activeAnnouncementsFor({ scope: "applicant" })).toHaveLength(0);
    await announcements.changeAnnouncement(superAdmin as never, a.id as string, "PUBLISH");
    expect(await announcements.activeAnnouncementsFor({ scope: "applicant" })).toHaveLength(1);
    expect(await announcements.activeAnnouncementsFor({ scope: "public" })).toHaveLength(0);
    expect(await announcements.activeAnnouncementsFor({ scope: "family" })).toHaveLength(0);
    const shown = (await announcements.activeAnnouncementsFor({ scope: "applicant" }))[0];
    expect(Object.keys(shown).sort()).toEqual(["body", "id", "kind", "title"]);
    await announcements.changeAnnouncement(superAdmin as never, a.id as string, "END");
    expect(await announcements.activeAnnouncementsFor({ scope: "applicant" })).toHaveLength(0);
    await expect(announcements.changeAnnouncement(superAdmin as never, a.id as string, "PUBLISH")).rejects.toMatchObject({ status: 409 });
  });
});

describe("the provider view never reveals a credential", () => {
  it("lists providers by status without any secret value", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_THIS_MUST_NEVER_APPEAR_123456");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-THIS_MUST_NEVER_APPEAR_654321");
    const views = await providers.listProviderViews();
    const json = JSON.stringify(views);
    expect(json).not.toContain("THIS_MUST_NEVER_APPEAR");
    expect(views.find((v) => v.key === "payments:STRIPE")?.status).toBe("CONNECTED");
    for (const v of views) expect(["CONNECTED", "HEALTHY", "DEGRADED", "UNAVAILABLE", "DISABLED", "NOT_CONFIGURED"]).toContain(v.status);
  });

  it("a test needs the manage permission and an unknown provider cannot be tested", async () => {
    await expect(providers.testProvider(viewer as never, "database")).rejects.toMatchObject({ status: 403 });
    await expect(providers.testProvider(superAdmin as never, "../../etc/passwd")).rejects.toMatchObject({ status: 400 });
  });
});

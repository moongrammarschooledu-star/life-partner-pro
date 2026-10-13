import { beforeEach, describe, expect, it, vi } from "vitest";

// STEP 37 — the mobile services over an in-memory database: device registration and ownership, push tokens, removal and session revocation, the push
// dispatcher's rules (flags, preferences, quiet hours, restrictions, rate cap, invalid tokens), release moves with the approval gate, version policy and the
// deep-link resolver.

type Row = Record<string, unknown> & { id?: string };
const h = vi.hoisted(() => ({ fake: null as unknown as ReturnType<typeof import("@/test-utils/fake-prisma").createFakeDb> }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { createFakeDb } = await import("@/test-utils/fake-prisma");
  h.fake = createFakeDb({
    defaults: { mobileDevice: { status: "ACTIVE", pushTokenEnc: null, pushTokenHash: null, pushProvider: null, pushTokenAt: null, displayMode: null, biometricEnabled: false, removedAt: null, osVersion: null, deviceLabel: null, sessionId: null, profileId: null, familyMemberId: null, createdAt: new Date(), lastSeenAt: new Date() }, mobileRelease: { status: "DRAFT", approvedById: null, releasedAt: null, rollbackReferenceId: null } },
    unique: { mobileDevice: ["installationId"], mobileVersionPolicy: ["platform"] },
  });
  return { prisma: h.fake.prisma };
});

const flags = new Set<string>();
const events: Array<{ type: string; meta: Row; actor: unknown }> = [];
const audits: Row[] = [];
const revoked: Array<{ kind: string; sessionId: string }> = [];
const restricted = new Set<string>();
let gateRequiresApproval = false;
const gateCalls: Row[] = [];
let provider = { id: "FCM" as "FCM" | "APNS", configured: true, validate: true, outcome: { status: "SENT", providerMessageId: "m1" } as Row, sent: [] as Array<{ token: string; content: Row }> };
let proposalDetail: unknown = { code: "LPP-RP-000001" };

vi.mock("@/lib/ops/feature-flags", () => ({ isFeatureEnabled: vi.fn(async (k: string) => flags.has(k)), isFeatureEnabledFor: vi.fn(async (k: string) => flags.has(k)), getAllFeatureFlags: vi.fn(async () => ({})) }));
vi.mock("@/lib/mobile/security-events", () => ({ mobileEvent: vi.fn(async (type: string, actor: unknown, meta: Row = {}) => { events.push({ type, meta, actor }); }) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/profile-session", () => ({ revokeProfileSession: vi.fn(async (sessionId: string) => { revoked.push({ kind: "PROFILE", sessionId }); }) }));
vi.mock("@/lib/family/family-member-session", () => ({ revokeFamilyMemberSession: vi.fn(async (sessionId: string) => { revoked.push({ kind: "FAMILY", sessionId }); }) }));
vi.mock("@/lib/profile-restrictions", () => ({ hasActiveRestriction: vi.fn(async (profileId: string) => restricted.has(profileId)) }));
vi.mock("@/lib/platform/settings", () => ({ getSettingValues: vi.fn(async () => ({ "localization.timezone": "UTC" })) }));
vi.mock("@/lib/platform/guard", () => ({ assertConfigChangeAllowed: vi.fn(async (p: { reason: unknown }) => ({ environment: "PRODUCTION", reason: String(p.reason), via: "NO_FREEZE" })) }));
vi.mock("@/lib/platform/environment", () => ({ currentEnvironment: () => "PRODUCTION" }));
vi.mock("@/lib/approvals/gate", () => ({
  enforceApprovalGate: vi.fn(async (p: Row) => {
    gateCalls.push(p);
    return gateRequiresApproval ? { requiresApproval: true, status: "ALREADY_PENDING", approvalRequestId: "ar1", approvalCode: "LPP-APR-000009" } : { requiresApproval: false };
  }),
  markApprovalExecuted: vi.fn(),
}));
vi.mock("@/lib/visibility/proposal-visibility", () => ({ buildProposalDetailForProfile: vi.fn(async () => proposalDetail) }));
vi.mock("@/lib/mobile/push/registry", () => ({
  providerForPlatform: vi.fn(() => ({ id: provider.id, isConfigured: () => provider.configured, validateToken: () => provider.validate, send: async (token: string, content: Row) => { provider.sent.push({ token, content }); return provider.outcome; }, sendBatch: async () => [] })),
  getPushProvider: vi.fn(() => ({ isConfigured: () => provider.configured })),
}));

const devices = await import("./device-service");
const push = await import("./push-service");
const releases = await import("./release-service");
const versions = await import("./version-service");
const link = await import("./deep-link-service");
const analytics = await import("./analytics");

type Actor = import("./auth").MobileActor;
const alice: Actor = { kind: "PROFILE", profileId: "prof-alice", sessionId: "sess-alice" };
const bob: Actor = { kind: "PROFILE", profileId: "prof-bob", sessionId: "sess-bob" };
const fam: Actor = { kind: "FAMILY", familyMemberId: "fam-1", sessionId: "sess-fam" };
const rows = (t: string) => h.fake.rows(t);
const INSTALL_A = "install-aaaaaaaaaaaaaaaa";
const INSTALL_B = "install-bbbbbbbbbbbbbbbb";
const reg = (actor: Actor, installationId = INSTALL_A, extra: Row = {}) => devices.registerDevice(actor, { installationId, platform: "ANDROID", appVersion: "1.0.0", osVersion: "Android 14", deviceLabel: "Pixel 7", ...extra });
const tokenFor = (n: number) => `fcm-token-${n}-`.padEnd(70, "x");
const admin = { id: "adm1", role: "SUPER_ADMIN", permissions: ["platform:mobile:view", "platform:mobile:manage", "platform:mobile:push"] } as never;

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "unit-test-secret-unit-test-secret-1234";
  for (const t of ["mobileDevice", "mobilePushDelivery", "mobileRelease", "mobileVersionPolicy", "mobileEventCounter", "platformConfigChange", "notificationPreference", "appSettings"]) rows(t).length = 0;
  flags.clear();
  for (const f of ["mobile.app.enabled", "mobile.push.enabled", "notifications.enabled", "mobile.deep_links.enabled"]) flags.add(f);
  events.length = 0;
  audits.length = 0;
  revoked.length = 0;
  restricted.clear();
  gateRequiresApproval = false;
  gateCalls.length = 0;
  provider = { id: "FCM", configured: true, validate: true, outcome: { status: "SENT", providerMessageId: "m1" }, sent: [] };
  proposalDetail = { code: "LPP-RP-000001" };
});

describe("device registration", () => {
  it("registers a device for the signed-in person and publishes security events", async () => {
    const d = await reg(alice);
    expect(d).toMatchObject({ platform: "ANDROID", appVersion: "1.0.0", deviceLabel: "Pixel 7", pushEnabled: false, isCurrent: true });
    expect(rows("mobileDevice")[0]).toMatchObject({ profileId: "prof-alice", sessionId: "sess-alice", ownerKind: "PROFILE", familyMemberId: null });
    expect(events.map((e) => e.type)).toEqual(["MOBILE_DEVICE_REGISTERED", "MOBILE_SESSION_CREATED"]);
  });
  it("is idempotent for the same person and notes an app update", async () => {
    await reg(alice);
    events.length = 0;
    await reg(alice, INSTALL_A, { appVersion: "1.1.0" });
    expect(rows("mobileDevice")).toHaveLength(1);
    expect(events.map((e) => e.type)).toEqual(["MOBILE_APP_UPDATED"]);
  });
  it("a family member's device is owned by the family member, not the applicant", async () => {
    await reg(fam, INSTALL_B);
    expect(rows("mobileDevice")[0]).toMatchObject({ familyMemberId: "fam-1", profileId: null, ownerKind: "FAMILY" });
  });
  it("an install that changes hands loses the previous owner's token and biometric choice, and raises a warning", async () => {
    await reg(alice);
    await devices.registerPushToken(alice, { installationId: INSTALL_A, token: tokenFor(1) });
    await devices.updateDeviceSettings(alice, String(rows("mobileDevice")[0].id), { biometricEnabled: true });
    events.length = 0;
    await reg(bob);
    const row = rows("mobileDevice")[0];
    expect(row).toMatchObject({ profileId: "prof-bob", sessionId: "sess-bob", pushTokenEnc: null, pushTokenHash: null, biometricEnabled: false });
    expect(events.map((e) => e.type)).toContain("MOBILE_SECURITY_WARNING");
  });
  it("refuses an invalid registration, a platform mismatch, a bad version and too many devices", async () => {
    await expect(devices.registerDevice(alice, { installationId: "short", platform: "ANDROID", appVersion: "1.0.0" })).rejects.toMatchObject({ status: 400 });
    await expect(devices.registerDevice(alice, { installationId: INSTALL_A, platform: "WINDOWS", appVersion: "1.0.0" })).rejects.toMatchObject({ status: 400 });
    await expect(devices.registerDevice(alice, { installationId: INSTALL_A, platform: "ANDROID", appVersion: "latest" })).rejects.toMatchObject({ status: 400 });
    await reg(alice);
    await expect(devices.registerDevice(alice, { installationId: INSTALL_A, platform: "IOS", appVersion: "1.0.0" })).rejects.toMatchObject({ status: 409 });
    for (let i = 0; i < devices.MAX_ACTIVE_DEVICES - 1; i++) await reg(alice, `install-${String(i).padStart(16, "0")}`);
    await expect(reg(alice, "install-overflow-000000")).rejects.toMatchObject({ status: 409 });
  });
  it("cleans the device label (no control characters or markup)", async () => {
    const d = await reg(alice, INSTALL_A, { deviceLabel: "<b>Pixel</b>\u0000 7" });
    expect(d.deviceLabel).toBe("bPixel/b 7");
  });
});

describe("device ownership (no IDOR)", () => {
  it("lists only the caller's own devices, without any token", async () => {
    await reg(alice);
    await reg(bob, INSTALL_B);
    await devices.registerPushToken(alice, { installationId: INSTALL_A, token: tokenFor(1) });
    const mine = await devices.listDevices(alice, INSTALL_A);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ pushEnabled: true, isCurrent: true });
    expect(JSON.stringify(mine)).not.toMatch(/fcm-token|pushToken|Enc|Hash|installationId|profileId|sessionId/);
  });
  it("another person's device id behaves exactly like one that does not exist", async () => {
    await reg(alice);
    const aliceDeviceId = String(rows("mobileDevice")[0].id);
    await expect(devices.removeDevice(bob, aliceDeviceId)).rejects.toMatchObject({ status: 404 });
    await expect(devices.removeDevice(bob, "does-not-exist")).rejects.toMatchObject({ status: 404 });
    await expect(devices.updateDeviceSettings(bob, aliceDeviceId, { displayMode: "OFF" })).rejects.toMatchObject({ status: 404 });
    await expect(devices.registerPushToken(bob, { installationId: INSTALL_A, token: tokenFor(1) })).rejects.toMatchObject({ status: 404 });
    await expect(devices.unregisterPushToken(bob, INSTALL_A)).rejects.toMatchObject({ status: 404 });
    expect(rows("mobileDevice")[0]).toMatchObject({ status: "ACTIVE", displayMode: null });
  });
  it("removing a device deletes its token, signs its session out, and says so in the security events", async () => {
    await reg(alice);
    await devices.registerPushToken(alice, { installationId: INSTALL_A, token: tokenFor(1) });
    const id = String(rows("mobileDevice")[0].id);
    const r = await devices.removeDevice(alice, id);
    expect(r).toEqual({ removed: true, endedCurrentSession: true });
    expect(rows("mobileDevice")[0]).toMatchObject({ status: "REMOVED", pushTokenEnc: null, pushTokenHash: null });
    expect(revoked).toEqual([{ kind: "PROFILE", sessionId: "sess-alice" }]);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["MOBILE_SESSION_REVOKED", "MOBILE_DEVICE_REMOVED"]));
    await expect(devices.removeDevice(alice, id)).rejects.toMatchObject({ status: 404 });
  });
  it("a family device removal signs out the family session", async () => {
    await reg(fam, INSTALL_B);
    await devices.removeDevice(fam, String(rows("mobileDevice")[0].id));
    expect(revoked).toEqual([{ kind: "FAMILY", sessionId: "sess-fam" }]);
  });
  it("an administrator can remove a lost device, with a reason in the audit log", async () => {
    await reg(alice);
    await devices.adminRemoveDevice("adm1", String(rows("mobileDevice")[0].id), "reported lost");
    expect(rows("mobileDevice")[0].status).toBe("REMOVED");
    expect(audits[0]).toMatchObject({ action: "MOBILE_DEVICE_REMOVED_BY_ADMIN", adminId: "adm1" });
  });
});

describe("push tokens", () => {
  it("are stored encrypted, never in clear, and recorded as a token change", async () => {
    await reg(alice);
    await devices.registerPushToken(alice, { installationId: INSTALL_A, token: tokenFor(1) });
    const row = rows("mobileDevice")[0];
    expect(String(row.pushTokenEnc)).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toContain(tokenFor(1));
    expect(row.pushProvider).toBe("FCM");
    expect(devices.tokenOf(row as never)).toBe(tokenFor(1));
    expect(events.map((e) => e.type)).toContain("MOBILE_PUSH_TOKEN_CHANGED");
  });
  it("a token that appears on another installation is removed from the old one", async () => {
    await reg(alice);
    await reg(bob, INSTALL_B);
    await devices.registerPushToken(alice, { installationId: INSTALL_A, token: tokenFor(7) });
    await devices.registerPushToken(bob, { installationId: INSTALL_B, token: tokenFor(7) });
    const a = rows("mobileDevice").find((r) => r.installationId === INSTALL_A)!;
    const b = rows("mobileDevice").find((r) => r.installationId === INSTALL_B)!;
    expect(a.pushTokenEnc).toBeNull();
    expect(b.pushTokenEnc).not.toBeNull();
  });
  it("a token the provider rejects at registration is refused; unregistering clears it", async () => {
    await reg(alice);
    provider.validate = false;
    await expect(devices.registerPushToken(alice, { installationId: INSTALL_A, token: tokenFor(1) })).rejects.toMatchObject({ status: 400 });
    provider.validate = true;
    await devices.registerPushToken(alice, { installationId: INSTALL_A, token: tokenFor(1) });
    await devices.unregisterPushToken(alice, INSTALL_A);
    expect(rows("mobileDevice")[0].pushTokenEnc).toBeNull();
  });
});

describe("push dispatch", () => {
  const note = (o: Row = {}) => ({ id: "nt1", type: "PROPOSAL_RECEIVED", title: "Proposal update", body: "There is an update.", actionUrl: "/my-proposals", category: "PROPOSAL", priority: "NORMAL", profileId: "prof-alice", familyMemberId: null, ...o }) as never;
  async function ready(actor: Actor = alice, install = INSTALL_A) {
    await reg(actor, install);
    await devices.registerPushToken(actor, { installationId: install, token: tokenFor(1) });
  }

  it("sends one generic notification to the person's device and records it", async () => {
    await ready();
    const s = await push.dispatchPushForNotification(note());
    expect(s).toMatchObject({ considered: 1, sent: 1 });
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0].token).toBe(tokenFor(1));
    expect(provider.sent[0].content).toEqual({ title: "Life Partner Pro", body: "You have a new update in Life Partner Pro.", data: { n: "nt1", p: "/my-proposals" } });
    expect(rows("mobilePushDelivery")[0]).toMatchObject({ status: "SENT", notificationId: "nt1" });
  });
  it("the account's display choice and the device's choice are applied", async () => {
    await ready();
    rows("notificationPreference").push({ id: "np1", profileId: "prof-alice", pushDisplayMode: "MINIMAL", inAppProposalUpdates: true, inAppMeetingUpdates: true });
    await push.dispatchPushForNotification(note());
    expect((provider.sent[0].content as Row).body).toBe("Open the app.");
    await devices.updateDeviceSettings(alice, String(rows("mobileDevice")[0].id), { displayMode: "OFF" });
    provider.sent.length = 0;
    const s = await push.dispatchPushForNotification(note({ id: "nt2" }));
    expect(provider.sent).toHaveLength(0);
    expect(s.skipped).toBe(1);
    expect(rows("mobilePushDelivery").at(-1)).toMatchObject({ status: "SKIPPED", reason: "display_off" });
  });
  it("does nothing while the push flag, the app flag or the notifications flag is off", async () => {
    await ready();
    for (const f of ["mobile.push.enabled", "mobile.app.enabled", "notifications.enabled"]) {
      flags.delete(f);
      expect(await push.dispatchPushForNotification(note())).toMatchObject({ considered: 0, sent: 0 });
      flags.add(f);
    }
    expect(provider.sent).toHaveLength(0);
  });
  it("respects the person's own preference, restrictions and quiet hours", async () => {
    await ready();
    rows("notificationPreference").push({ id: "np1", profileId: "prof-alice", pushDisplayMode: "PRIVATE", inAppProposalUpdates: false, inAppMeetingUpdates: true });
    await push.dispatchPushForNotification(note());
    expect(rows("mobilePushDelivery").at(-1)).toMatchObject({ status: "SKIPPED", reason: "preference_off" });
    rows("notificationPreference").length = 0;

    restricted.add("prof-alice");
    await push.dispatchPushForNotification(note({ id: "nt3" }));
    expect(rows("mobilePushDelivery").at(-1)).toMatchObject({ reason: "account_restricted" });
    restricted.clear();

    rows("appSettings").push({ id: 1, quietHoursStart: 22, quietHoursEnd: 7 });
    const night = new Date(Date.UTC(2026, 9, 13, 23, 0));
    await push.dispatchPushForNotification(note({ id: "nt4" }), night);
    expect(rows("mobilePushDelivery").at(-1)).toMatchObject({ reason: "quiet_hours" });
    await push.dispatchPushForNotification(note({ id: "nt5", priority: "HIGH" }), night);
    expect(rows("mobilePushDelivery").at(-1)).toMatchObject({ status: "SENT" });
    expect(provider.sent).toHaveLength(1);
  });
  it("never pushes marketing, and never pushes for an administrator or without a recipient", async () => {
    await ready();
    expect(await push.dispatchPushForNotification(note({ category: "MARKETING" }))).toMatchObject({ considered: 0 });
    expect(await push.dispatchPushForNotification(note({ profileId: null, familyMemberId: null }))).toMatchObject({ considered: 0 });
    expect(provider.sent).toHaveLength(0);
  });
  it("skips (and says why) when the push provider is not configured or the cap per hour is reached", async () => {
    await ready();
    provider.configured = false;
    await push.dispatchPushForNotification(note());
    expect(rows("mobilePushDelivery").at(-1)).toMatchObject({ status: "SKIPPED", reason: "provider_not_configured" });
    provider.configured = true;
    const device = String(rows("mobileDevice")[0].id);
    for (let i = 0; i < push.MAX_PUSH_PER_DEVICE_PER_HOUR; i++) rows("mobilePushDelivery").push({ id: `d${i}`, deviceId: device, status: "SENT", createdAt: new Date() });
    await push.dispatchPushForNotification(note({ id: "nt9" }));
    expect(rows("mobilePushDelivery").at(-1)).toMatchObject({ status: "SKIPPED", reason: "rate_limited" });
  });
  it("a dead token is recorded and the device stops being used", async () => {
    await ready();
    provider.outcome = { status: "INVALID_TOKEN", reason: "unregistered" };
    const s = await push.dispatchPushForNotification(note());
    expect(s.invalidated).toBe(1);
    expect(rows("mobileDevice")[0]).toMatchObject({ status: "TOKEN_INVALID", pushTokenEnc: null });
    provider.outcome = { status: "SENT" };
    expect((await push.dispatchPushForNotification(note({ id: "nt10" }))).considered).toBe(0);
  });
  it("a provider failure is counted and never thrown", async () => {
    await ready();
    provider.outcome = { status: "FAILED", reason: "fcm_503", retryable: true };
    await expect(push.dispatchPushForNotification(note())).resolves.toMatchObject({ failed: 1 });
  });
  it("a family member's notification goes to the family member's own device only", async () => {
    await ready(alice, INSTALL_A);
    await ready(fam, INSTALL_B);
    const s = await push.dispatchPushForNotification(note({ id: "nt11", profileId: null, familyMemberId: "fam-1", category: "FAMILY" }));
    expect(s).toMatchObject({ considered: 1, sent: 1 });
  });
  it("a test push is a fixed generic text to one device", async () => {
    await ready();
    const r = await push.sendTestPush(String(rows("mobileDevice")[0].id));
    expect(r.status).toBe("SENT");
    expect((provider.sent[0].content as Row).body).toBe("This is a test notification. Nothing needs your attention.");
    expect(await push.sendTestPush("missing")).toMatchObject({ status: "NO_TOKEN" });
  });
});

describe("releases", () => {
  const input = (o: Row = {}) => ({ platform: "ANDROID", version: "1.0.0", buildNumber: 1, releaseNotes: "First internal build", environment: "PRODUCTION", reason: "recording the build", ...o });
  it("records a draft and enforces the permission and the fields", async () => {
    const r = await releases.createRelease(admin, input());
    expect(r).toMatchObject({ status: "DRAFT", platform: "ANDROID", version: "1.0.0", buildNumber: 1 });
    await expect(releases.createRelease({ id: "x", permissions: [] } as never, input({ buildNumber: 2 }))).rejects.toMatchObject({ status: 403 });
    await expect(releases.createRelease(admin, input({ version: "one" }))).rejects.toMatchObject({ status: 400 });
    await expect(releases.createRelease(admin, input({ buildNumber: 0 }))).rejects.toMatchObject({ status: 400 });
    await expect(releases.createRelease(admin, input({ releaseNotes: "x" }))).rejects.toMatchObject({ status: 400 });
    await expect(releases.createRelease(admin, input())).rejects.toMatchObject({ status: 409 });
  });
  it("only legal moves are allowed", async () => {
    expect(releases.canMove("DRAFT", "INTERNAL_TESTING")).toBe(true);
    expect(releases.canMove("DRAFT", "PRODUCTION")).toBe(false);
    expect(releases.canMove("PRODUCTION", "PAUSED")).toBe(true);
    expect(releases.canMove("RETIRED", "PRODUCTION")).toBe(false);
    const r = await releases.createRelease(admin, input());
    await expect(releases.moveRelease(admin, String(r.id), { status: "PRODUCTION", reason: "going live now", environment: "PRODUCTION" })).rejects.toMatchObject({ status: 409 });
  });
  it("production goes through the approval gate and is held until approved", async () => {
    const r = await releases.createRelease(admin, input());
    await releases.moveRelease(admin, String(r.id), { status: "INTERNAL_TESTING", reason: "testing the build", environment: "PRODUCTION" });
    expect(gateCalls).toHaveLength(0);
    gateRequiresApproval = true;
    const held = await releases.moveRelease(admin, String(r.id), { status: "PRODUCTION", reason: "going live now", environment: "PRODUCTION" });
    expect(held).toMatchObject({ approvalRequired: true, approvalCode: "LPP-APR-000009" });
    expect(gateCalls[0]).toMatchObject({ actionType: "MOBILE_PRODUCTION_RELEASE" });
    expect(rows("mobileRelease")[0].status).toBe("INTERNAL_TESTING");
    gateRequiresApproval = false;
    const done = await releases.moveRelease(admin, String(r.id), { status: "PRODUCTION", reason: "going live now", environment: "PRODUCTION" });
    expect(done).toMatchObject({ approvalRequired: false, status: "PRODUCTION" });
    expect(rows("mobileRelease")[0].releasedAt).toBeInstanceOf(Date);
    expect(audits.at(-1)).toMatchObject({ action: "MOBILE_RELEASE_CHANGED" });
  });
  it("a rollback reference must be a release of the same platform", async () => {
    const a = await releases.createRelease(admin, input());
    const b = await releases.createRelease(admin, input({ version: "1.0.1", buildNumber: 2 }));
    const other = await releases.createRelease(admin, input({ platform: "IOS", version: "1.0.0", buildNumber: 1 }));
    await releases.moveRelease(admin, String(b.id), { status: "INTERNAL_TESTING", reason: "testing the build", environment: "PRODUCTION" });
    await expect(releases.moveRelease(admin, String(b.id), { status: "PAUSED", rollbackReferenceId: String(other.id), reason: "pausing it now", environment: "PRODUCTION" })).rejects.toMatchObject({ status: 400 });
    await releases.moveRelease(admin, String(b.id), { status: "PAUSED", rollbackReferenceId: String(a.id), reason: "pausing it now", environment: "PRODUCTION" });
    expect(rows("mobileRelease").find((r) => r.id === b.id)).toMatchObject({ status: "PAUSED", rollbackReferenceId: a.id });
  });
});

describe("version policy", () => {
  const set = (o: Row = {}) => versions.setVersionPolicy(admin, { platform: "ANDROID", minimumSupportedVersion: "1.0.0", recommendedVersion: "1.1.0", latestVersion: "1.2.0", reason: "release 1.2.0 is out", environment: "PRODUCTION", ...o });
  it("defaults to accepting every version until a policy is set", async () => {
    expect(await versions.versionAnswer("ANDROID", "1.0.0")).toMatchObject({ status: "OK", storeUrl: null });
  });
  it("saves a policy, versions it, logs the change, and drives the answer", async () => {
    expect(await set()).toMatchObject({ platform: "ANDROID", version: 1 });
    expect(await set({ minimumSupportedVersion: "1.1.0", recommendedVersion: "1.1.5" })).toMatchObject({ version: 2 });
    expect(rows("platformConfigChange")).toHaveLength(2);
    expect(audits.at(-1)).toMatchObject({ action: "MOBILE_VERSION_POLICY_CHANGED" });
    expect(await versions.versionAnswer("ANDROID", "1.0.5")).toMatchObject({ status: "UPDATE_REQUIRED", message: "Please update Life Partner Pro to continue." });
    expect(await versions.versionAnswer("ANDROID", "1.1.0")).toMatchObject({ status: "UPDATE_RECOMMENDED" });
    expect(await versions.versionAnswer("ANDROID", "1.2.0")).toMatchObject({ status: "OK" });
    expect(await versions.versionAnswer("IOS", "1.0.0")).toMatchObject({ status: "OK" }); // a different platform keeps its own (default) policy
  });
  it("refuses an inconsistent policy, an unofficial update address, the wrong platform and a missing permission", async () => {
    await expect(set({ minimumSupportedVersion: "3.0.0" })).rejects.toMatchObject({ status: 400 });
    await expect(set({ storeUrl: "https://evil.example.com/app.apk" })).rejects.toMatchObject({ status: 400 });
    await expect(set({ platform: "WINDOWS" })).rejects.toMatchObject({ status: 400 });
    await expect(versions.setVersionPolicy({ id: "x", permissions: ["platform:mobile:view"] } as never, { platform: "ANDROID", minimumSupportedVersion: "1.0.0", recommendedVersion: "1.0.0", latestVersion: "1.0.0", reason: "no permission here", environment: "PRODUCTION" })).rejects.toMatchObject({ status: 403 });
    expect(rows("mobileVersionPolicy")).toHaveLength(0);
  });
  it("accepts an official store address", async () => {
    await set({ storeUrl: "https://play.google.com/store/apps/details?id=com.lifepartnerpro.app" });
    expect((await versions.versionAnswer("ANDROID", "1.2.0")).storeUrl).toContain("play.google.com");
  });
});

describe("deep link resolution", () => {
  const url = "https://lifepartnerpro.vercel.app/my-proposals";
  it("signed out: asks the person to sign in, and says nothing else", async () => {
    expect(await link.resolveDeepLink(null, url)).toEqual({ allowed: false, reason: "SIGN_IN_REQUIRED", path: "/login" });
    expect(await link.resolveDeepLink(null, "https://lifepartnerpro.vercel.app/family/dashboard")).toMatchObject({ reason: "SIGN_IN_REQUIRED", path: "/family/dashboard" });
  });
  it("signed in: opens a known route", async () => {
    expect(await link.resolveDeepLink(alice, url)).toEqual({ allowed: true, path: "/my-proposals" });
    expect(events.at(-1)).toMatchObject({ type: "MOBILE_DEEP_LINK_OPENED", meta: { result: "OPENED" } });
  });
  it("a proposal that is not the caller's looks exactly like one that does not exist", async () => {
    const detailUrl = "/dashboard/proposals/LPP-RP-000999";
    expect(await link.resolveDeepLink(alice, detailUrl)).toEqual({ allowed: true, path: detailUrl });
    proposalDetail = null;
    expect(await link.resolveDeepLink(alice, detailUrl)).toEqual({ allowed: false, reason: "NOT_FOUND" });
    expect(await link.resolveDeepLink(alice, "/dashboard/proposals/DOES-NOT-EXIST")).toEqual({ allowed: false, reason: "NOT_FOUND" });
  });
  it("the wrong kind of account, an unknown route, another host or a secret in the link all answer NOT_FOUND", async () => {
    expect(await link.resolveDeepLink(fam, "/my-proposals")).toEqual({ allowed: false, reason: "NOT_FOUND" });
    expect(await link.resolveDeepLink(alice, "/family/dashboard")).toEqual({ allowed: false, reason: "NOT_FOUND" });
    for (const bad of ["/admin/dashboard", "https://evil.example.com/dashboard", "/dashboard?token=abc", "javascript:alert(1)", "/dashboard/../admin", null]) expect(await link.resolveDeepLink(alice, bad), String(bad)).toEqual({ allowed: false, reason: "NOT_FOUND" });
    expect(events.filter((e) => e.type === "MOBILE_DEEP_LINK_OPENED").every((e) => e.meta.result !== "OPENED")).toBe(true);
  });
  it("is off when the deep-link flag or the app flag is off", async () => {
    flags.delete("mobile.deep_links.enabled");
    expect(await link.resolveDeepLink(alice, url)).toEqual({ allowed: false, reason: "DISABLED" });
    flags.add("mobile.deep_links.enabled");
    flags.delete("mobile.app.enabled");
    expect(await link.resolveDeepLink(alice, url)).toEqual({ allowed: false, reason: "DISABLED" });
  });
});

describe("app analytics storage", () => {
  it("records nothing unless it is switched on, and only counts of known events", async () => {
    expect(await analytics.recordMobileEvents({ platform: "ANDROID", appVersion: "1.0.0", events: ["APP_OPENED"] })).toEqual({ recorded: 0 });
    process.env.MOBILE_ANALYTICS_ENABLED = "true";
    try {
      const day = new Date(Date.UTC(2026, 9, 13, 5));
      expect(await analytics.recordMobileEvents({ platform: "ANDROID", appVersion: "1.0.0", events: ["APP_OPENED", "APP_OPENED", "BOGUS", { name: "PROPOSAL_VIEWED", phone: "0300" }] }, day)).toEqual({ recorded: 3 });
      await analytics.recordMobileEvents({ platform: "ANDROID", appVersion: "1.0.0", events: ["APP_OPENED"] }, day);
      const stored = rows("mobileEventCounter");
      expect(stored.find((r) => r.event === "APP_OPENED")?.count).toBe(3);
      expect(JSON.stringify(stored)).not.toMatch(/0300|phone|profile|session/i);
      expect(await analytics.recordMobileEvents({ platform: "WINDOWS", appVersion: "1.0.0", events: ["APP_OPENED"] })).toEqual({ recorded: 0 });
      expect(await analytics.recordMobileEvents({ platform: "IOS", appVersion: "bad", events: ["APP_OPENED"] })).toEqual({ recorded: 0 });
    } finally {
      delete process.env.MOBILE_ANALYTICS_ENABLED;
    }
  });
});


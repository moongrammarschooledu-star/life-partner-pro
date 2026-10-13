import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { validateValue, looksLikeSecret, safeConfigValue } from "./config-values";
import { evaluateFlag, rolloutBucket, validateFlagRule, enabledForEveryone, isActivation, type FlagRule } from "./flag-eval";
import { decideUnderFreeze, clampBreakGlassMinutes, canReviewBreakGlass, breakGlassActive } from "./freeze-rules";
import { publicSafetyProblems, validateAudience, isAnnouncementLive, audienceMatches, isPublicFacing } from "./announcement-rules";
import { diffConfig } from "./config-diff";
import { assertEnvironmentMatches, currentEnvironment } from "./environment";
import { buildPublicStatus } from "./status";
import { maintenanceKindOf } from "./maintenance";
import { SECTIONS, sectionsFor, findSection, visibleLinks } from "./sections";
import { SETTING_DEFS, permissionForSetting, settingDefaults } from "./settings-registry";
import { PROVIDER_STATUSES, fromHealthCheck, fromCommunicationProvider, outcomeToStatus, safeDiagnostic } from "./provider-status";
import { isBlockedByReadOnly, isExemptFromMaintenance } from "@/lib/ops/system-state";
import { ROLE_PERMISSIONS, SENSITIVE_PERMISSIONS } from "@/lib/permissions";

// STEP 36 — the pure rules of the Control Center: typed values and secret rejection, flag evaluation and targeting, change freeze and break-glass, public
// announcement safety, safe comparison, environment naming, the public status payload, read-only enforcement and the permission model.

describe("typed configuration values", () => {
  it("accepts a valid value of each type and rejects the wrong type", () => {
    expect(validateValue({ type: "STRING", maxLength: 10 }, " hi ")).toEqual({ ok: true, value: "hi" });
    expect(validateValue({ type: "STRING" }, 5).ok).toBe(false);
    expect(validateValue({ type: "STRING" }, "").ok).toBe(false);
    expect(validateValue({ type: "STRING", allowEmpty: true }, "")).toEqual({ ok: true, value: "" });
    expect(validateValue({ type: "INTEGER", min: 1, max: 5 }, 3).ok).toBe(true);
    expect(validateValue({ type: "INTEGER", min: 1, max: 5 }, 6).ok).toBe(false);
    expect(validateValue({ type: "INTEGER" }, 1.5).ok).toBe(false);
    expect(validateValue({ type: "DECIMAL" }, 1.5).ok).toBe(true);
    expect(validateValue({ type: "DECIMAL" }, Number.NaN).ok).toBe(false);
    expect(validateValue({ type: "BOOLEAN" }, "true").ok).toBe(false);
    expect(validateValue({ type: "ENUM", enumValues: ["a", "b"] }, "c").ok).toBe(false);
    expect(validateValue({ type: "ENUM", enumValues: ["a", "b"] }, "a").ok).toBe(true);
  });

  it("URLs must be https, without credentials", () => {
    expect(validateValue({ type: "URL" }, "http://example.com").ok).toBe(false);
    expect(validateValue({ type: "URL" }, "https://user:pw@example.com").ok).toBe(false);
    expect(validateValue({ type: "URL" }, "not a url").ok).toBe(false);
    expect(validateValue({ type: "URL" }, "https://example.com/a").ok).toBe(true);
    expect(validateValue({ type: "URL", allowEmpty: true }, "")).toEqual({ ok: true, value: "" });
  });

  it("a secret reference can only be the NAME of an environment variable", () => {
    expect(validateValue({ type: "SECRET_REFERENCE" }, "SMTP_PASSWORD").ok).toBe(true);
    expect(validateValue({ type: "SECRET_REFERENCE" }, "hunter2-the-actual-secret").ok).toBe(false);
    expect(validateValue({ type: "SECRET_REFERENCE" }, "abc").ok).toBe(false);
  });

  it("refuses values shaped like secrets", () => {
    const samples = [
      "sk_live_abcdefghijklmnop",
      "-----BEGIN " + "PRIVATE KEY-----",
      "Bearer abcdefghijklmnopqrstuvwxyz0123",
      "postgresql://user:pass@host/db",
      "ghp_abcdefghijklmnop1234",
      "AKIA" + "ABCDEFGHIJKLMNOP",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
    ];
    for (const s of samples) {
      expect(looksLikeSecret(s), s).toBe(true);
      expect(validateValue({ type: "STRING", maxLength: 400 }, s).ok, s).toBe(false);
    }
    expect(looksLikeSecret("Life Partner Pro")).toBe(false);
  });

  it("JSON values are size-limited, shallow and cannot carry prototype keys or secrets", () => {
    expect(validateValue({ type: "JSON" }, { a: 1 }).ok).toBe(true);
    expect(validateValue({ type: "JSON" }, JSON.parse('{"__proto__": {"x": 1}}')).ok).toBe(false);
    expect(validateValue({ type: "JSON" }, { a: { b: { c: { d: { e: { f: 1 } } } } } }).ok).toBe(false);
    expect(validateValue({ type: "JSON", maxLength: 20 }, { text: "x".repeat(50) }).ok).toBe(false);
    expect(validateValue({ type: "JSON" }, { token: "sk_live_abcdefghijklmnop" }).ok).toBe(false);
  });

  it("history values hide secret-looking keys and text", () => {
    expect(safeConfigValue("smtp.password", "anything")).toBe("[hidden]");
    expect(safeConfigValue("note", "sk_live_abcdefghijklmnop")).toBe("[hidden]");
    expect(safeConfigValue("cfg", { apiKey: "x", name: "ok" })).toEqual({ apiKey: "[hidden]", name: "ok" });
    expect(safeConfigValue("password_ref", "SMTP_PASSWORD")).toBe("SMTP_PASSWORD");
  });
});

describe("feature flag rules and evaluation", () => {
  it("validates states, percentages and targets", () => {
    expect(validateFlagRule({ state: "NOPE" }).ok).toBe(false);
    expect(validateFlagRule({ state: "ROLLOUT" }).ok).toBe(false); // nobody selected
    expect(validateFlagRule({ state: "ROLLOUT", rolloutPercent: 101 }).ok).toBe(false);
    expect(validateFlagRule({ state: "ROLLOUT", rolloutPercent: 10.5 }).ok).toBe(false);
    expect(validateFlagRule({ state: "ROLLOUT", rolloutPercent: 10 }).ok).toBe(true);
    expect(validateFlagRule({ state: "ENABLED", rolloutPercent: 10 }).ok).toBe(false); // would silently not apply
    expect(validateFlagRule({ state: "ROLLOUT", targets: [{ type: "SPECIFIC_ROLE", values: ["NOT_A_ROLE"] }] }).ok).toBe(false);
    expect(validateFlagRule({ state: "ROLLOUT", targets: [{ type: "SPECIFIC_ROLE" }] }).ok).toBe(false);
    expect(validateFlagRule({ state: "ROLLOUT", targets: [{ type: "RELIGION", values: ["x"] }] }).ok).toBe(false);
    expect(validateFlagRule({ state: "ROLLOUT", targets: [{ type: "ADMIN_ONLY" }] }).ok).toBe(true);
    expect(validateFlagRule({ state: "ROLLOUT", targets: [{ type: "ENVIRONMENT", values: ["staging"] }] })).toMatchObject({ ok: true, rule: { targets: [{ type: "ENVIRONMENT", values: ["STAGING"] }] } });
  });

  it("targeting has no profile-attribute types (religion, sect, caste, health, income, looks, age)", () => {
    const attrs = ["RELIGION", "SECT", "CASTE", "HEALTH", "INCOME", "LOOKS", "AGE", "GENDER", "FAMILY"];
    for (const a of attrs) expect(validateFlagRule({ state: "ROLLOUT", targets: [{ type: a, values: ["x"] }] }).ok, a).toBe(false);
  });

  it("only ENABLED is on globally; paused, disabled and emergency-disabled are off", () => {
    const r = (state: FlagRule["state"]): FlagRule => ({ state, rolloutPercent: null, targets: [] });
    expect(evaluateFlag("f.x", r("ENABLED"), undefined, "PRODUCTION")).toBe(true);
    for (const s of ["DISABLED", "PAUSED", "EMERGENCY_DISABLED", "ROLLOUT"] as const) expect(evaluateFlag("f.x", r(s), undefined, "PRODUCTION"), s).toBe(false);
    expect(enabledForEveryone("ENABLED")).toBe(true);
    expect(enabledForEveryone("ROLLOUT")).toBe(false);
  });

  it("a percentage rollout is stable per person and roughly proportional", () => {
    expect(rolloutBucket("f.x", "user-1")).toBe(rolloutBucket("f.x", "user-1"));
    const rule: FlagRule = { state: "ROLLOUT", rolloutPercent: 30, targets: [] };
    let on = 0;
    for (let i = 0; i < 2000; i++) if (evaluateFlag("f.x", rule, { id: `user-${i}` }, "PRODUCTION")) on++;
    expect(on).toBeGreaterThan(450);
    expect(on).toBeLessThan(750);
    expect(evaluateFlag("f.x", { ...rule, rolloutPercent: 0 }, { id: "user-1" }, "PRODUCTION")).toBe(false);
    expect(evaluateFlag("f.x", { ...rule, rolloutPercent: 100 }, { id: "user-1" }, "PRODUCTION")).toBe(true);
    expect(evaluateFlag("f.x", rule, {}, "PRODUCTION")).toBe(false); // no subject id, no bucket
  });

  it("role, user, country, environment and admin targets", () => {
    const t = (type: string, values?: string[]): FlagRule => ({ state: "ROLLOUT", rolloutPercent: null, targets: [{ type: type as never, values }] });
    expect(evaluateFlag("f", t("ADMIN_ONLY"), { isAdmin: true }, "PRODUCTION")).toBe(true);
    expect(evaluateFlag("f", t("ADMIN_ONLY"), { isAdmin: false }, "PRODUCTION")).toBe(false);
    expect(evaluateFlag("f", t("SPECIFIC_ROLE", ["SUPER_ADMIN"]), { role: "SUPER_ADMIN" }, "PRODUCTION")).toBe(true);
    expect(evaluateFlag("f", t("SPECIFIC_ROLE", ["SUPER_ADMIN"]), { role: "SUPPORT_MANAGER" }, "PRODUCTION")).toBe(false);
    expect(evaluateFlag("f", t("SPECIFIC_USER", ["abc123"]), { id: "abc123" }, "PRODUCTION")).toBe(true);
    expect(evaluateFlag("f", t("COUNTRY", ["Pakistan"]), { country: "pakistan" }, "PRODUCTION")).toBe(true);
    expect(evaluateFlag("f", t("COUNTRY", ["Pakistan"]), { country: "India" }, "PRODUCTION")).toBe(false);
    expect(evaluateFlag("f", t("ENVIRONMENT", ["STAGING"]), {}, "STAGING")).toBe(true);
    expect(evaluateFlag("f", t("ENVIRONMENT", ["STAGING"]), {}, "PRODUCTION")).toBe(false);
  });

  it("only turning something on is an activation", () => {
    expect(isActivation("DISABLED", "ENABLED")).toBe(true);
    expect(isActivation("PAUSED", "ROLLOUT")).toBe(true);
    expect(isActivation("ENABLED", "DISABLED")).toBe(false);
    expect(isActivation("ENABLED", "PAUSED")).toBe(false);
    expect(isActivation("ROLLOUT", "ENABLED")).toBe(false); // already on for some
  });
});

describe("change freeze and break-glass", () => {
  const frozen = { active: true, reason: "release" };
  it("no freeze: allowed", () => {
    expect(decideUnderFreeze({ freeze: { active: false }, restrictive: false, hasActiveBreakGlass: false, holdsFreezePermission: false })).toEqual({ allowed: true, via: "NO_FREEZE" });
  });
  it("freeze: ordinary change refused with a message", () => {
    const d = decideUnderFreeze({ freeze: frozen, restrictive: false, hasActiveBreakGlass: false, holdsFreezePermission: true });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.error).toMatch(/freeze/i);
  });
  it("freeze: break-glass or a restrictive emergency action by a freeze holder goes through", () => {
    expect(decideUnderFreeze({ freeze: frozen, restrictive: false, hasActiveBreakGlass: true, holdsFreezePermission: false })).toEqual({ allowed: true, via: "BREAK_GLASS" });
    expect(decideUnderFreeze({ freeze: frozen, restrictive: true, hasActiveBreakGlass: false, holdsFreezePermission: true })).toEqual({ allowed: true, via: "RESTRICTIVE_EMERGENCY" });
  });
  it("freeze: a restrictive action without the freeze permission is still refused; enabling never rides the emergency path", () => {
    expect(decideUnderFreeze({ freeze: frozen, restrictive: true, hasActiveBreakGlass: false, holdsFreezePermission: false }).allowed).toBe(false);
    expect(decideUnderFreeze({ freeze: frozen, restrictive: false, hasActiveBreakGlass: false, holdsFreezePermission: true }).allowed).toBe(false);
  });
  it("break-glass is time-limited between 5 and 60 minutes", () => {
    expect(clampBreakGlassMinutes(1)).toBe(5);
    expect(clampBreakGlassMinutes(9999)).toBe(60);
    expect(clampBreakGlassMinutes("x")).toBe(30);
    expect(clampBreakGlassMinutes(20.9)).toBe(20);
  });
  it("break-glass expires and ends", () => {
    const now = new Date("2026-10-13T10:00:00Z");
    expect(breakGlassActive({ expiresAt: new Date("2026-10-13T10:05:00Z"), endedAt: null }, now)).toBe(true);
    expect(breakGlassActive({ expiresAt: new Date("2026-10-13T09:59:00Z"), endedAt: null }, now)).toBe(false);
    expect(breakGlassActive({ expiresAt: new Date("2026-10-13T10:05:00Z"), endedAt: now }, now)).toBe(false);
  });
  it("review: not your own, not while active, not twice", () => {
    const now = new Date("2026-10-13T10:00:00Z");
    const ended = { adminId: "a1", expiresAt: new Date("2026-10-13T09:00:00Z"), endedAt: null, reviewedAt: null };
    expect(canReviewBreakGlass(ended, "a1", now).ok).toBe(false);
    expect(canReviewBreakGlass(ended, "a2", now).ok).toBe(true);
    expect(canReviewBreakGlass({ ...ended, expiresAt: new Date("2026-10-13T11:00:00Z") }, "a2", now).ok).toBe(false);
    expect(canReviewBreakGlass({ ...ended, reviewedAt: now }, "a2", now).ok).toBe(false);
  });
});

describe("announcements and the public status page", () => {
  it("public text may not carry internal detail", () => {
    const bad = [
      "Database at 10.0.0.5 is down",
      "see /src/lib/foo.ts",
      "C:\\Users\\app\\log.txt failed",
      "Error: boom\n    at run (/app/x.js:10:5)",
      "db.internal unreachable",
      "postgres://u:p@h/db",
      "we raised the rate limit threshold",
      "token sk_live_abcdefghijklmnop",
    ];
    for (const b of bad) expect(publicSafetyProblems(b).length, b).toBeGreaterThan(0);
    expect(publicSafetyProblems("The site will be unavailable on Sunday from 2 to 4 pm for planned maintenance.")).toEqual([]);
  });
  it("audiences are validated", () => {
    expect(validateAudience([]).ok).toBe(false);
    expect(validateAudience(["EVERYONE"]).ok).toBe(false);
    expect(validateAudience(["all", "APPLICANTS", "applicants"])).toEqual({ ok: true, audience: ["ALL", "APPLICANTS"] });
    expect(validateAudience(["ROLE:SUPER_ADMIN"]).ok).toBe(true);
    expect(validateAudience(["ROLE:NOPE"]).ok).toBe(false);
    expect(isPublicFacing(["ADMINS"], false)).toBe(false);
    expect(isPublicFacing(["ADMINS"], true)).toBe(true);
    expect(isPublicFacing(["APPLICANTS"], false)).toBe(true);
  });
  it("live window and audience matching", () => {
    const now = new Date("2026-10-13T10:00:00Z");
    expect(isAnnouncementLive({ status: "DRAFT", startsAt: null, endsAt: null }, now)).toBe(false);
    expect(isAnnouncementLive({ status: "PUBLISHED", startsAt: null, endsAt: null }, now)).toBe(true);
    expect(isAnnouncementLive({ status: "PUBLISHED", startsAt: new Date("2026-10-14T00:00:00Z"), endsAt: null }, now)).toBe(false);
    expect(isAnnouncementLive({ status: "PUBLISHED", startsAt: null, endsAt: new Date("2026-10-13T09:00:00Z") }, now)).toBe(false);
    expect(audienceMatches(["APPLICANTS"], { scope: "applicant" })).toBe(true);
    expect(audienceMatches(["APPLICANTS"], { scope: "public" })).toBe(false);
    expect(audienceMatches(["ALL"], { scope: "public" })).toBe(true);
    expect(audienceMatches(["ADMINS"], { scope: "applicant" })).toBe(false);
    expect(audienceMatches(["ROLE:SUPER_ADMIN"], { scope: "admin", role: "SUPER_ADMIN" })).toBe(true);
  });

  const base = { operationalState: "NORMAL", maintenanceMode: "OFF" as const, maintenanceStartsAt: null, maintenanceEndsAt: null, maintenanceMessage: null, emergencyPublicAccessDisabled: false, readOnly: false };
  const now = new Date("2026-10-13T10:00:00Z");
  const ann = (o: Record<string, unknown> = {}) => ({ kind: "PLATFORM_UPDATE" as const, title: "T", body: "B", status: "PUBLISHED", showOnStatusPage: true, startsAt: null, endsAt: null, resolvedAt: null, createdAt: new Date("2026-10-12T00:00:00Z"), ...o });

  it("status: operational by default, then maintenance, read-only and disruption", () => {
    expect(buildPublicStatus({ control: base, announcements: [], settings: {}, now }).state).toBe("OPERATIONAL");
    expect(buildPublicStatus({ control: { ...base, maintenanceMode: "ON" }, announcements: [], settings: {}, now }).state).toBe("MAINTENANCE");
    expect(buildPublicStatus({ control: { ...base, readOnly: true }, announcements: [], settings: {}, now }).state).toBe("READ_ONLY");
    expect(buildPublicStatus({ control: { ...base, emergencyPublicAccessDisabled: true }, announcements: [], settings: {}, now }).state).toBe("DISRUPTION");
    expect(buildPublicStatus({ control: base, announcements: [ann({ kind: "SERVICE_INTERRUPTION" })], settings: {}, now }).state).toBe("DISRUPTION");
  });
  it("status: scheduled maintenance is announced ahead of time", () => {
    const s = buildPublicStatus({ control: { ...base, maintenanceMode: "SCHEDULED", maintenanceStartsAt: new Date("2026-10-15T10:00:00Z"), maintenanceEndsAt: new Date("2026-10-15T12:00:00Z"), maintenanceMessage: "Short break" }, announcements: [], settings: {}, now });
    expect(s.state).toBe("SCHEDULED_MAINTENANCE");
    expect(s.scheduledMaintenance).toHaveLength(1);
  });
  it("status: only notices marked for the status page are shown, drafts never", () => {
    const s = buildPublicStatus({ control: base, announcements: [ann({ title: "shown" }), ann({ title: "hidden", showOnStatusPage: false }), ann({ title: "draft", status: "DRAFT" })], settings: {}, now });
    expect(s.notices.map((n) => n.title)).toEqual(["shown"]);
  });
  it("status: the payload exposes no internal fields", () => {
    const s = buildPublicStatus({ control: { ...base, operationalState: "EMERGENCY" }, announcements: [ann()], settings: { "contact.public_email": "help@example.com" }, now });
    const json = JSON.stringify(s);
    for (const forbidden of ["emergency", "operationalState", "createdById", "updatedById", "audience", "reason", "stack", "postgres"]) expect(json.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    expect(Object.keys(s).sort()).toEqual(["contact", "enabled", "generatedAt", "headline", "message", "notices", "platformName", "scheduledMaintenance", "state", "timezone"]);
  });
  it("status: can be switched off by a setting", () => {
    expect(buildPublicStatus({ control: base, announcements: [], settings: { "status.page_enabled": false }, now }).enabled).toBe(false);
  });
});

describe("safe comparison", () => {
  it("shows field-level differences and hides secrets on both sides", () => {
    expect(diffConfig("x", { a: 1, b: 2 }, { a: 1, b: 3, c: 4 }).map((d) => [d.path, d.change])).toEqual([["b", "changed"], ["c", "added"]]);
    const d = diffConfig("x", { apiKey: "old" }, { apiKey: "new" });
    expect(d).toEqual([]); // both hidden, so "unchanged": a secret's difference is not revealed
    expect(diffConfig("x", "a", "b")[0].path).toBe("(value)");
  });
});

describe("environment naming", () => {
  it("detects the environment", () => {
    expect(currentEnvironment({ VERCEL_ENV: "production" })).toBe("PRODUCTION");
    expect(currentEnvironment({ VERCEL_ENV: "preview" })).toBe("STAGING");
    expect(currentEnvironment({ NODE_ENV: "development" })).toBe("DEVELOPMENT");
  });
  it("a change must name the environment it runs in", () => {
    const env = { VERCEL_ENV: "production" };
    expect(assertEnvironmentMatches("production", env)).toBe("PRODUCTION");
    expect(assertEnvironmentMatches(" Production ", env)).toBe("PRODUCTION");
    expect(() => assertEnvironmentMatches(undefined, env)).toThrow(/environment/i);
    expect(() => assertEnvironmentMatches("", env)).toThrow();
    expect(() => assertEnvironmentMatches("staging", env)).toThrow(/not STAGING|Nothing was changed/);
  });
});

describe("maintenance and read-only mode", () => {
  it("maps SystemControl onto the four kinds", () => {
    const c = { maintenanceMode: "OFF" as const, readOnly: false, maintenanceStartsAt: null, maintenanceEndsAt: null };
    expect(maintenanceKindOf(c)).toBe("NORMAL");
    expect(maintenanceKindOf({ ...c, maintenanceMode: "SCHEDULED" })).toBe("SCHEDULED_MAINTENANCE");
    expect(maintenanceKindOf({ ...c, maintenanceMode: "ON" })).toBe("EMERGENCY_MAINTENANCE");
    expect(maintenanceKindOf({ ...c, readOnly: true })).toBe("READ_ONLY");
  });
  it("read-only blocks writes by the public and applicants but never reads, admin, auth, webhooks, cron or sign-in", () => {
    expect(isBlockedByReadOnly("GET", "/dashboard")).toBe(false);
    expect(isBlockedByReadOnly("POST", "/api/register")).toBe(true);
    expect(isBlockedByReadOnly("PATCH", "/api/my-profile")).toBe(true);
    expect(isBlockedByReadOnly("DELETE", "/api/my-documents/abc")).toBe(true);
    for (const p of ["/api/admin/system/control", "/api/auth/callback", "/api/webhooks/payments/stripe", "/api/cron/daily", "/api/health", "/api/my-status", "/api/family/login", "/api/family/logout"]) expect(isBlockedByReadOnly("POST", p), p).toBe(false);
  });
  it("the public status page stays reachable during maintenance", () => {
    expect(isExemptFromMaintenance("/status")).toBe(true);
    expect(isExemptFromMaintenance("/api/status")).toBe(true);
    expect(isExemptFromMaintenance("/admin/control-center")).toBe(true);
    expect(isExemptFromMaintenance("/dashboard")).toBe(false);
  });
});

describe("providers", () => {
  it("one status vocabulary", () => {
    expect([...PROVIDER_STATUSES]).toEqual(["CONNECTED", "HEALTHY", "DEGRADED", "UNAVAILABLE", "DISABLED", "NOT_CONFIGURED"]);
    expect(fromHealthCheck("ok")).toBe("HEALTHY");
    expect(fromHealthCheck("down")).toBe("UNAVAILABLE");
    expect(fromCommunicationProvider({ active: true, healthStatus: "HEALTHY" }, false)).toBe("NOT_CONFIGURED");
    expect(fromCommunicationProvider({ active: false, healthStatus: "HEALTHY" }, true)).toBe("DISABLED");
    expect(outcomeToStatus("TIMEOUT")).toBe("DEGRADED");
  });
  it("diagnostics are short, flat and token-free", () => {
    const d = safeDiagnostic(`line one\nline two ${"A".repeat(60)} ${"z".repeat(500)}`);
    expect(d).not.toContain("\n");
    expect(d.length).toBeLessThanOrEqual(200);
    expect(d).not.toContain("A".repeat(40));
  });
});

describe("settings registry and sections", () => {
  it("every setting has a valid default and a unique key", () => {
    const keys = new Set<string>();
    for (const d of SETTING_DEFS) {
      expect(keys.has(d.key), d.key).toBe(false);
      keys.add(d.key);
      expect(validateValue(d, d.default).ok, d.key).toBe(true);
      expect(d.type, d.key).not.toBe("SECRET_REFERENCE");
    }
    expect(Object.keys(settingDefaults()).length).toBe(SETTING_DEFS.length);
  });
  it("branding and contact settings use the branding permission, the rest the settings permission", () => {
    for (const d of SETTING_DEFS) expect(permissionForSetting(d)).toBe(d.category === "branding" || d.category === "contact" ? "platform:branding:manage" : "platform:settings:manage");
  });
  it("sections are unique, each demands a real permission, and nothing shows without the Control Center permission", () => {
    expect(new Set(SECTIONS.map((s) => s.key)).size).toBe(SECTIONS.length);
    const all = new Set(Object.values(ROLE_PERMISSIONS).flat());
    for (const s of SECTIONS) if (s.requires) expect(all.has(s.requires), s.key).toBe(true);
    expect(sectionsFor(["platform:settings:view"])).toEqual([]);
    expect(sectionsFor(["platform:control_center:view"]).map((s) => s.key)).toEqual(["overview"]);
    expect(findSection("nope")).toBeUndefined();
    const sec = findSection("security")!;
    expect(visibleLinks(sec, ["platform:control_center:view"]).every((l) => !l.permission)).toBe(true);
  });
  it("every sensitive platform action is marked sensitive", () => {
    for (const p of ["platform:break_glass", "platform:change_freeze", "platform:configuration:rollback", "platform:providers:manage", "platform:settings:manage"]) expect(SENSITIVE_PERMISSIONS.includes(p as never), p).toBe(true);
  });
});

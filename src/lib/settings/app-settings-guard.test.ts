import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { EDITABLE_APP_SETTINGS, PROTECTED_APP_SETTINGS, SECURITY_APP_SETTINGS, effectiveWeights, matchingConfigProblems, sanitiseAppSettingsPatch } from "@/lib/settings/app-settings-guard";

// The stored row, as the settings page receives and sends it back.
const current: Record<string, unknown> = {
  id: 1, updatedAt: new Date("2026-01-01T00:00:00Z"), appName: "Life Partner Pro", contactEmail: null, contactWhatsapp: null, contactAddress: null,
  weightAge: 15, weightLocation: 15, weightEducation: 10, weightProfession: 10, weightIncome: 10, weightMaritalStatus: 10, weightHeight: 5, weightFamily: 10, weightReligious: 10, weightLifestyle: 5, weightLanguages: 5,
  thresholdExcellent: 90, thresholdVeryGood: 80, thresholdGood: 65, thresholdPossible: 50,
  categoryEnabledAge: true, categoryEnabledLocation: true, categoryEnabledEducation: true, categoryEnabledProfession: true, categoryEnabledIncome: true, categoryEnabledMaritalStatus: true,
  categoryEnabledHeight: true, categoryEnabledFamily: true, categoryEnabledReligious: true, categoryEnabledLifestyle: true, categoryEnabledLanguages: true,
  maxMatchResults: 10, otpExpiryMinutes: 10, loginMaxAttempts: 5, passwordMinLength: 8, quietHoursStart: null, quietHoursEnd: null,
  paymentRolloutStage: "DISABLED", paymentsEnabled: false, checkoutEnabled: false, activePaymentProvider: "MANUAL", defaultCurrencyCode: "PKR", paymentBetaPercentage: 0, lastScheduledReconciliationAt: null,
};

describe("settings PATCH allow-list (mass-assignment fix)", () => {
  it("refuses to change the payment rollout stage, the master payment switches and the active provider, naming where they are managed", () => {
    for (const patch of [{ paymentRolloutStage: "PRODUCTION" }, { paymentsEnabled: true }, { checkoutEnabled: true }, { activePaymentProvider: "STRIPE" }, { defaultCurrencyCode: "USD" }, { paymentBetaPercentage: 100 }]) {
      const r = sanitiseAppSettingsPatch(patch, current);
      expect(r.ok, JSON.stringify(patch)).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(403);
        expect(r.error).toMatch(/managed in/);
      }
    }
  });

  it("accepts the whole row coming back unchanged: metadata, protected and unchanged values are dropped, nothing is written", () => {
    const r = sanitiseAppSettingsPatch({ ...current }, current);
    expect(r).toEqual({ ok: true, data: {}, ignored: [] });
  });

  it("writes only changed, allow-listed settings", () => {
    const r = sanitiseAppSettingsPatch({ ...current, maxMatchResults: 20, appName: " Life Partner Pro " }, current);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ maxMatchResults: 20 });
  });

  it("rejects unknown keys, malformed JSON-ish values and out-of-range numbers", () => {
    for (const patch of [{ isAdmin: true }, { __proto__x: 1 }, { weightAge: 101 }, { weightAge: -1 }, { weightAge: 1.5 }, { maxMatchResults: 0 }, { otpExpiryMinutes: 999 }, { passwordMinLength: 4 }, { loginMaxAttempts: 0 }, { contactEmail: "x".repeat(300) }, { defaultNotificationLanguage: "FR" }, { twoFactorRequiredRoles: ["ROOT"] }, { ageRangeBuckets: "nope" }, { ageRangeBuckets: [{ a: { b: 1 } }] }]) {
      const r = sanitiseAppSettingsPatch(patch as Record<string, unknown>, current);
      expect(r.ok, JSON.stringify(patch)).toBe(false);
    }
  });

  it("keeps the match tiers strictly descending and quiet hours distinct", () => {
    expect(sanitiseAppSettingsPatch({ thresholdGood: 85 }, current).ok).toBe(false);
    expect(sanitiseAppSettingsPatch({ thresholdExcellent: 70 }, current).ok).toBe(false);
    expect(sanitiseAppSettingsPatch({ thresholdPossible: 60, thresholdGood: 70 }, current).ok).toBe(true);
    expect(sanitiseAppSettingsPatch({ quietHoursStart: 22, quietHoursEnd: 22 }, current).ok).toBe(false);
    expect(sanitiseAppSettingsPatch({ quietHoursStart: 22, quietHoursEnd: 6 }, current).ok).toBe(true);
  });

  it("security settings are identified so the route can demand a fresh password", () => {
    const r = sanitiseAppSettingsPatch({ loginMaxAttempts: 8 }, current);
    expect(r.ok && Object.keys(r.data).some((k) => (SECURITY_APP_SETTINGS as readonly string[]).includes(k))).toBe(true);
  });

  it("no protected setting is also editable, and every editable key is a real column of the settings row", () => {
    for (const k of Object.keys(PROTECTED_APP_SETTINGS)) expect(k in EDITABLE_APP_SETTINGS, k).toBe(false);
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const model = /model AppSettings \{([\s\S]*?)\n\}/.exec(schema)![1];
    for (const k of Object.keys(EDITABLE_APP_SETTINGS)) expect(new RegExp(`^\\s+${k}\\s`, "m").test(model), k).toBe(true);
    for (const k of Object.keys(PROTECTED_APP_SETTINGS)) expect(new RegExp(`^\\s+${k}\\s`, "m").test(model), k).toBe(true);
  });

  it("the route no longer passes the request body to the database", () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/admin/settings/route.ts"), "utf8");
    expect(src).toContain("sanitiseAppSettingsPatch(");
    expect(src).not.toMatch(/update:\s*body/);
    expect(src).not.toMatch(/(update|data):\s*(body\b|\{\s*\.\.\.body)/);
  });
});

describe("matching weights normalise to 100% (STEP 36 §22)", () => {
  it("the shipped defaults (which add up to 105) become exactly 100% effective", () => {
    const rows = effectiveWeights(current);
    expect(Math.round(rows.reduce((s, r) => s + r.percent, 0) * 100)).toBe(10_000);
    expect(matchingConfigProblems(current)).toEqual([]);
  });

  it("a disabled category drops out and the rest still total 100%", () => {
    const rows = effectiveWeights({ ...current, categoryEnabledIncome: false, categoryEnabledReligious: false });
    expect(rows.find((r) => r.category === "Income")?.percent).toBe(0);
    expect(Math.round(rows.reduce((s, r) => s + r.percent, 0) * 100)).toBe(10_000);
  });

  it("a configuration that could score nothing is reported", () => {
    const zero = Object.fromEntries(Object.keys(current).filter((k) => k.startsWith("weight")).map((k) => [k, 0]));
    expect(matchingConfigProblems({ ...current, ...zero }).length).toBeGreaterThan(0);
  });

  it("the settings schema has no field for attractiveness, facial, sensitive-trait or marriage-outcome scoring (STEP 36 §23)", () => {
    const names = [...Object.keys(EDITABLE_APP_SETTINGS), ...Object.keys(PROTECTED_APP_SETTINGS)].join(" ");
    expect(names).not.toMatch(/attractiv|facial|face|beauty|looks|complexion|skin|caste|ethnic|psycholog|personalityScore|predict|guarantee|successProbab/i);
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const model = /model AppSettings \{([\s\S]*?)\n\}/.exec(schema)![1];
    expect(model).not.toMatch(/attractiv|facial|beauty|complexion|predict|guarantee/i);
  });
});

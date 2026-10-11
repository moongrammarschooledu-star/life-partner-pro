import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

// STEP 32 — the pure half of the Security Operations Center: the rule catalog, the rolling-window engine, rule-version policy, the alert state
// machine, escalation timing and settings validation. No database, no clock.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { RULES, getRuleDefinition } = await import("./rules/registry");
const { rollingPeak, evaluateObservations, isWeakening, needsSecondReviewer, validateRuleConfig, RULE_BOUNDS } = await import("./rules/engine");
const { ALERT_TRANSITIONS, canTransition, needsResolutionText } = await import("./alerts");
const { escalationTarget, escalationMinutes } = await import("./escalation");
const { validateSettingsPatch } = await import("./settings");

const ROOT = join(__dirname, "..", "..", "..");
const schema = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");
const enumValues = (name: string): string[] => {
  const start = schema.indexOf(`enum ${name} {`);
  const body = schema.slice(start, schema.indexOf("\n}", start));
  return body.split(/\r?\n/).slice(1).map((l) => l.replace(/\/\/.*/, "").trim()).filter(Boolean);
};

const MIN = 60_000;
const pts = (times: number[], keys?: string[]) => times.map((t, i) => ({ t: t * MIN, key: keys?.[i], ref: `e${i}` }));

describe("the rule catalog", () => {
  it("has at least 15 rules with unique keys", () => {
    expect(RULES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(RULES.map((r) => r.key)).size).toBe(RULES.length);
  });

  it("every default configuration is itself valid", () => {
    for (const r of RULES) expect(validateRuleConfig({}, r.defaults).ok, r.key).toBe(true);
  });

  it("every rule reads only real event types and maps to a real incident category", () => {
    const events = new Set(enumValues("SecurityEventType"));
    const categories = new Set(enumValues("SocIncidentCategory"));
    for (const r of RULES) {
      expect(categories.has(r.category), `${r.key} category ${r.category}`).toBe(true);
      if (r.query.kind === "events") for (const t of r.query.types) expect(events.has(t), `${r.key} reads ${t}`).toBe(true);
    }
  });

  it("titles and descriptions are neutral: no rule accuses a person", () => {
    const banned = /\b(fraud(ster|ulent)?|criminal|attacker|hacker|guilty|culprit|thief|scammer|cheat(er)?|liar)\b/i;
    for (const r of RULES) {
      expect(`${r.title} ${r.name} ${r.description}`, r.key).not.toMatch(banned);
      expect(r.title, r.key).toMatch(/^(Suspicious activity detected|Attention needed)/);
    }
  });

  it("covers each area the spec names", () => {
    const keys = RULES.map((r) => r.key).join(" ");
    for (const area of ["failed_logins", "credential_stuffing", "sensitive_access_burst", "bulk_exports", "excessive_searches", "permission_denied", "doc.", "api.", "session", "webhook.replays", "privilege_changes", "backup.deletion"]) expect(keys, area).toContain(area);
  });

  it("protects the rules whose weakening would blind the SOC to the worst events", () => {
    for (const k of ["auth.credential_stuffing", "admin.break_glass_use", "data.bulk_exports", "webhook.signature_failures", "backup.failed", "doc.tamper_detected"]) expect(getRuleDefinition(k)?.protectedRule, k).toBe(true);
  });
});

describe("rolling windows", () => {
  it("finds a burst inside a long quiet period (a once-a-day job must still see it)", () => {
    // a burst of 6 within 10 minutes at hour 3, plus a scatter across the day
    const burst = [180, 181, 183, 185, 186, 190];
    const noise = [10, 400, 700, 900, 1200];
    const p = rollingPeak(pts([...noise, ...burst]), 30 * MIN, false);
    expect(p.peak).toBe(6);
    expect(p.windowStart).toBe(180 * MIN);
    expect(p.windowEnd).toBe(190 * MIN);
  });

  it("does not combine events that are spread out wider than the window", () => {
    expect(rollingPeak(pts([0, 40, 80, 120, 160, 200]), 30 * MIN, false).peak).toBe(1);
  });

  it("counts events exactly one window apart as inside it", () => {
    expect(rollingPeak(pts([0, 30]), 30 * MIN, false).peak).toBe(2);
    expect(rollingPeak(pts([0, 31]), 30 * MIN, false).peak).toBe(1);
  });

  it("in distinct mode counts different keys, not repeats", () => {
    const p = rollingPeak(pts([0, 1, 2, 3, 4, 5], ["a", "a", "a", "b", "b", "c"]), 60 * MIN, true);
    expect(p.peak).toBe(3);
  });

  it("is order-independent and handles empty input", () => {
    expect(rollingPeak([], 60 * MIN, false).peak).toBe(0);
    expect(rollingPeak(pts([5, 1, 3]), 60 * MIN, false).peak).toBe(3);
  });
});

describe("evaluating a rule", () => {
  const rule = getRuleDefinition("auth.failed_logins")!; // threshold 8 / 30 min
  const obs = (n: number, spread = 1) => ({ subject: "subjectKey:a", resource: "ACCOUNT:a", points: pts(Array.from({ length: n }, (_, i) => i * spread)) });

  it("fires at the threshold and not one below it", () => {
    expect(evaluateObservations(rule, [obs(7)], rule.defaults)).toHaveLength(0);
    const f = evaluateObservations(rule, [obs(8)], rule.defaults);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ observed: 8, resource: "ACCOUNT:a" });
    expect(f[0].summary).toBe("8 failed sign-ins within 30 minutes (threshold 8).");
  });

  it("a disabled rule never fires", () => {
    expect(evaluateObservations(rule, [obs(50)], { ...rule.defaults, enabled: false })).toHaveLength(0);
  });

  it("keeps at most ten evidence pointers and orders findings largest first", () => {
    const many = obs(30);
    const small = { ...obs(9), subject: "subjectKey:b", resource: "ACCOUNT:b" };
    const out = evaluateObservations(rule, [small, many], rule.defaults);
    expect(out.map((f) => f.observed)).toEqual([30, 9]);
    expect(out[0].evidence).toHaveLength(10);
    expect(out[0].evidence[0]).toMatchObject({ type: "SecurityEvent" });
  });

  it("a distinct-key rule needs enough different accounts, not just many attempts", () => {
    const stuffing = getRuleDefinition("auth.credential_stuffing")!; // 6 distinct / 60 min
    const same = { subject: "ipHash:n", resource: "NETWORK:n", points: pts([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], Array(10).fill("acct-1")) };
    expect(evaluateObservations(stuffing, [same], stuffing.defaults)).toHaveLength(0);
    const spread = { ...same, points: pts([0, 1, 2, 3, 4, 5], ["a", "b", "c", "d", "e", "f"]) };
    expect(evaluateObservations(stuffing, [spread], stuffing.defaults)).toHaveLength(1);
  });

  it("the finding text holds counts and windows only", () => {
    const f = evaluateObservations(rule, [obs(8)], rule.defaults)[0];
    expect(f.summary).not.toMatch(/@|https?:|[0-9a-f]{20,}/);
  });
});

describe("rule versions: what counts as weakening", () => {
  const base = { enabled: true, severity: "HIGH" as const, threshold: 5, windowMinutes: 60 };
  it("switching off, lowering severity, raising the threshold or shortening the window are weakening", () => {
    expect(isWeakening(base, { ...base, enabled: false })).toBe(true);
    expect(isWeakening(base, { ...base, severity: "MEDIUM" })).toBe(true);
    expect(isWeakening(base, { ...base, threshold: 6 })).toBe(true);
    expect(isWeakening(base, { ...base, windowMinutes: 30 })).toBe(true);
  });
  it("the opposite changes are not", () => {
    expect(isWeakening(base, { ...base, severity: "CRITICAL" })).toBe(false);
    expect(isWeakening(base, { ...base, threshold: 4 })).toBe(false);
    expect(isWeakening(base, { ...base, windowMinutes: 90 })).toBe(false);
    expect(isWeakening({ ...base, enabled: false }, base)).toBe(false);
  });
  it("a weakening of a protected or HIGH+ rule needs a second reviewer; a LOW unprotected one does not", () => {
    expect(needsSecondReviewer({ protectedRule: true }, { ...base, severity: "LOW" }, { ...base, severity: "LOW", threshold: 9 })).toBe(true);
    expect(needsSecondReviewer({ protectedRule: false }, base, { ...base, threshold: 9 })).toBe(true);
    expect(needsSecondReviewer({ protectedRule: false }, { ...base, severity: "LOW" }, { ...base, severity: "LOW", threshold: 9 })).toBe(false);
    expect(needsSecondReviewer({ protectedRule: true }, base, { ...base, threshold: 2 })).toBe(false); // strengthening never needs review
  });
  it("rejects nonsense values", () => {
    expect(validateRuleConfig({ threshold: 0 }, base).ok).toBe(false);
    expect(validateRuleConfig({ threshold: 1.5 }, base).ok).toBe(false);
    expect(validateRuleConfig({ threshold: RULE_BOUNDS.thresholdMax + 1 }, base).ok).toBe(false);
    expect(validateRuleConfig({ windowMinutes: 1 }, base).ok).toBe(false);
    expect(validateRuleConfig({ severity: "SEVERE" as never }, base).ok).toBe(false);
    expect(validateRuleConfig({ threshold: 7 }, base)).toMatchObject({ ok: true, config: { threshold: 7, severity: "HIGH" } });
  });
});

describe("the alert state machine", () => {
  it("follows NEW → ACKNOWLEDGED → INVESTIGATING → RESOLVED → CLOSED", () => {
    expect(canTransition("NEW", "ACKNOWLEDGED")).toBe(true);
    expect(canTransition("ACKNOWLEDGED", "INVESTIGATING")).toBe(true);
    expect(canTransition("INVESTIGATING", "RESOLVED")).toBe(true);
    expect(canTransition("RESOLVED", "CLOSED")).toBe(true);
  });
  it("cannot skip steps or leave CLOSED", () => {
    expect(canTransition("NEW", "RESOLVED")).toBe(false);
    expect(canTransition("NEW", "INVESTIGATING")).toBe(false);
    expect(canTransition("ACKNOWLEDGED", "RESOLVED")).toBe(false);
    expect(ALERT_TRANSITIONS.CLOSED).toEqual([]);
    for (const to of Object.keys(ALERT_TRANSITIONS)) expect(canTransition("CLOSED", to as never)).toBe(false);
  });
  it("supports false positive and escalation from the working states", () => {
    for (const from of ["NEW", "ACKNOWLEDGED", "INVESTIGATING"] as const) {
      expect(canTransition(from, "FALSE_POSITIVE")).toBe(true);
      expect(canTransition(from, "ESCALATED")).toBe(true);
    }
    expect(canTransition("ESCALATED", "ACKNOWLEDGED")).toBe(true);
  });
  it("only resolving or dismissing needs a written resolution", () => {
    expect(needsResolutionText("RESOLVED")).toBe(true);
    expect(needsResolutionText("FALSE_POSITIVE")).toBe(true);
    for (const s of ["ACKNOWLEDGED", "INVESTIGATING", "ESCALATED", "CLOSED"] as const) expect(needsResolutionText(s)).toBe(false);
  });
  it("every status the schema defines is covered by the machine", () => {
    expect(Object.keys(ALERT_TRANSITIONS).sort()).toEqual(enumValues("SocAlertStatus").sort());
  });
});

describe("escalation timing", () => {
  const settings = { escalateCriticalMinutes: 15, escalateHighMinutes: 60, escalateMediumMinutes: 480 };
  const t0 = new Date("2026-10-09T08:00:00Z");
  const alert = (severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL", level = 0, status: "NEW" | "ESCALATED" | "ACKNOWLEDGED" = "NEW", acked = false) =>
    ({ severity, status, createdAt: t0, escalationLevel: level, acknowledgedAt: acked ? t0 : null });
  const at = (min: number) => new Date(t0.getTime() + min * MIN);

  it("uses the severity's own limit", () => {
    expect(escalationMinutes("CRITICAL", settings)).toBe(15);
    expect(escalationMinutes("HIGH", settings)).toBe(60);
    expect(escalationMinutes("LOW", settings)).toBe(0);
  });
  it("moves to level 1 after N minutes and level 2 after 2N, never past 2", () => {
    expect(escalationTarget(alert("HIGH"), settings, at(59))).toBeNull();
    expect(escalationTarget(alert("HIGH"), settings, at(60))).toBe(1);
    expect(escalationTarget(alert("HIGH", 1, "ESCALATED"), settings, at(100))).toBeNull();
    expect(escalationTarget(alert("HIGH", 1, "ESCALATED"), settings, at(120))).toBe(2);
    expect(escalationTarget(alert("HIGH", 2, "ESCALATED"), settings, at(100000))).toBeNull();
  });
  it("never escalates an acknowledged alert or a severity set to 0", () => {
    expect(escalationTarget(alert("CRITICAL", 0, "NEW", true), settings, at(500))).toBeNull();
    expect(escalationTarget(alert("CRITICAL", 0, "ACKNOWLEDGED"), settings, at(500))).toBeNull();
    expect(escalationTarget(alert("LOW"), settings, at(100000))).toBeNull();
    expect(escalationTarget(alert("HIGH"), { ...settings, escalateHighMinutes: 0 }, at(100000))).toBeNull();
  });
});

describe("security configuration validation", () => {
  const current = { suppressionWindowMinutes: 240, escalateCriticalMinutes: 15, escalateHighMinutes: 60, escalateMediumMinutes: 480, sessionIdleMinutes: null, maxConcurrentSessions: null, stepUpForHighRisk: true, enforceMfaPrivileged: false, accessLogRetentionDays: 365, alertRetentionDays: 730 };
  it("returns only what changed", () => {
    expect(validateSettingsPatch(current, { escalateHighMinutes: 60, sessionIdleMinutes: 30 })).toEqual({ ok: true, changes: { sessionIdleMinutes: 30 } });
  });
  it("lets the session limits be switched off again with null, but nothing else", () => {
    expect(validateSettingsPatch({ ...current, sessionIdleMinutes: 30 }, { sessionIdleMinutes: null })).toMatchObject({ ok: true, changes: { sessionIdleMinutes: null } });
    expect(validateSettingsPatch(current, { escalateHighMinutes: null }).ok).toBe(false);
  });
  it("rejects unknown fields, fractions, out-of-range values and wrong types", () => {
    expect(validateSettingsPatch(current, { lastDetectionAt: "x" }).ok).toBe(false);
    expect(validateSettingsPatch(current, { escalateHighMinutes: 1.5 }).ok).toBe(false);
    expect(validateSettingsPatch(current, { sessionIdleMinutes: 1 }).ok).toBe(false);
    expect(validateSettingsPatch(current, { maxConcurrentSessions: 0 }).ok).toBe(false);
    expect(validateSettingsPatch(current, { accessLogRetentionDays: 5 }).ok).toBe(false);
    expect(validateSettingsPatch(current, { stepUpForHighRisk: "yes" }).ok).toBe(false);
  });
});

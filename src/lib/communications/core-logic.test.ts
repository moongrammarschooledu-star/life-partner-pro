import { describe, it, expect, vi } from "vitest";

// These modules import prisma at load time; the tests below only exercise their PURE functions.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/route-guard", () => ({ ApiError: class ApiError extends Error {} }));

import { destinationFor, overFrequency, suppressionApplies, withinQuietHours } from "@/lib/communications/policy-engine";
import { backoffSeconds, isRetryable } from "@/lib/communications/send-service";
import { nextStatus } from "@/lib/communications/webhook-service";
import { FOLLOWUP_RULE_DEFAULTS, repeatIndex, validateFollowUpRule } from "@/lib/communications/followup-automation";
import { containsContactPattern, staffCanSee, userCanSee } from "@/lib/communications/thread-service";
import { analyticsToCsv, parseAnalyticsRange, percentile, type CommunicationAnalytics } from "@/lib/communications/analytics";
import { decryptText, encryptText, isEncryptedToken } from "@/lib/communications/crypto";
import { packContent, readableText, unpackContent } from "@/lib/communications/content";
import { currentEnvironment, isTestRecipient, testModeWarning } from "@/lib/communications/environment";
import { ALLOWED_PURPOSES, CLASS_MESSAGE_TYPES, messageClassOf } from "@/lib/communications/classify";
import { POLICY_DEFAULTS, validatePolicyConfig } from "@/lib/communications/policy-config";
import { hashDestination, normalizeDestination } from "@/lib/communications/suppression-hash";
import { healthFromCounters, providerAlerts } from "@/lib/communications/provider-health";

describe("quiet hours", () => {
  const cfg = { start: "21:00", end: "08:00", timezone: "UTC" };
  it("detects a window that crosses midnight and reports when it ends", () => {
    expect(withinQuietHours(new Date("2026-01-01T22:30:00Z"), cfg)).toMatchObject({ quiet: true });
    expect(withinQuietHours(new Date("2026-01-01T03:00:00Z"), cfg).quiet).toBe(true);
    expect(withinQuietHours(new Date("2026-01-01T12:00:00Z"), cfg)).toEqual({ quiet: false, endsAt: null });
    const q = withinQuietHours(new Date("2026-01-01T22:00:00Z"), cfg);
    expect(q.endsAt?.toISOString()).toBe("2026-01-02T08:00:00.000Z");
  });
  it("uses the policy timezone, and an empty window is never quiet", () => {
    expect(withinQuietHours(new Date("2026-01-01T17:00:00Z"), { start: "21:00", end: "08:00", timezone: "Asia/Karachi" }).quiet).toBe(true); // 22:00 PKT
    expect(withinQuietHours(new Date("2026-01-01T12:00:00Z"), { start: "09:00", end: "09:00", timezone: "UTC" }).quiet).toBe(false);
  });
});

describe("frequency limits", () => {
  const now = new Date("2026-01-08T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const limit = { perHour: 2, perDay: 3, perWeek: 5 };
  it("counts each window separately", () => {
    expect(overFrequency([], limit, now).over).toBe(false);
    expect(overFrequency([ago(60_000), ago(120_000)], limit, now)).toEqual({ over: true, window: "hour" });
    expect(overFrequency([ago(2 * 3_600_000), ago(3 * 3_600_000), ago(5 * 3_600_000)], limit, now)).toEqual({ over: true, window: "day" });
    expect(overFrequency([1, 2, 3, 4, 5].map((d) => ago(d * 30 * 3_600_000)), limit, now)).toEqual({ over: true, window: "week" });
    expect(overFrequency([ago(8 * 86_400_000)], limit, now).over).toBe(false);
  });
  it("ships separate, stricter defaults for marketing than for transactional or security", () => {
    expect(POLICY_DEFAULTS.FREQUENCY.marketing.perDay).toBeLessThan(POLICY_DEFAULTS.FREQUENCY.transactional.perDay);
    expect(POLICY_DEFAULTS.FREQUENCY.security.perDay).toBeGreaterThanOrEqual(POLICY_DEFAULTS.FREQUENCY.transactional.perDay);
  });
});

describe("suppression scopes", () => {
  it("an unsubscribe from marketing never stops security or transactional messages, but a hard ALL suppression stops everything", () => {
    expect(suppressionApplies("MARKETING", "marketing")).toBe(true);
    expect(suppressionApplies("MARKETING", "transactional")).toBe(false);
    expect(suppressionApplies("MARKETING", "security")).toBe(false);
    expect(suppressionApplies("TRANSACTIONAL", "marketing")).toBe(false);
    for (const cls of ["marketing", "transactional", "security"] as const) expect(suppressionApplies("ALL", cls)).toBe(true);
  });
  it("hashes destinations consistently but never reversibly", () => {
    expect(hashDestination("A@B.com ")).toBe(hashDestination("a@b.com"));
    expect(hashDestination("+92 300 1234567")).toBe(hashDestination("+923001234567"));
    expect(hashDestination("a@b.com")).not.toContain("a@b.com");
    expect(hashDestination("a@b.com")).not.toBe(hashDestination("c@d.com"));
    expect(normalizeDestination("+92 300-1234567")).toBe("+923001234567");
  });
});

describe("destination resolution", () => {
  const contact = { mobileNumber: "+923001234567", whatsappNumber: null, email: "a@b.com" };
  it("uses the recipient's own contact fields and never substitutes the mobile number for WhatsApp", () => {
    expect(destinationFor("EMAIL", contact)).toBe("a@b.com");
    expect(destinationFor("SMS", contact)).toBe("+923001234567");
    expect(destinationFor("WHATSAPP", contact)).toBeNull();
    expect(destinationFor("WHATSAPP", { ...contact, whatsappNumber: "+923009999999" })).toBe("+923009999999");
    expect(destinationFor("IN_APP", contact)).toBeNull();
    expect(destinationFor("SMS", null)).toBeNull();
  });
});

describe("retry and backoff", () => {
  it("backs off exponentially and is capped", () => {
    const s = [1, 2, 3, 4, 5, 6].map((n) => backoffSeconds(n));
    expect(s[0]).toBeGreaterThanOrEqual(60);
    expect(s[0]).toBeLessThan(75); // base plus a small deterministic spread
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
    expect(backoffSeconds(30)).toBeLessThanOrEqual(6 * 3600 + 13); // capped at 6h
    expect(backoffSeconds(2, 10)).toBeGreaterThanOrEqual(20);
    expect(backoffSeconds(2, 10)).toBeLessThan(35);
  });
  it("retries only retryable failures", () => {
    expect(isRetryable("RETRYABLE")).toBe(true);
    expect(isRetryable("PERMANENT")).toBe(false);
    expect(isRetryable(null)).toBe(false);
  });
});

describe("delivery status state machine (never fabricates or regresses)", () => {
  it("moves only forward", () => {
    expect(nextStatus("SENT", "DELIVERED")).toBe("DELIVERED");
    expect(nextStatus("DELIVERED", "READ")).toBe("READ");
    expect(nextStatus("READ", "DELIVERED")).toBeNull(); // out-of-order event
    expect(nextStatus("DELIVERED", "SENT")).toBeNull();
    expect(nextStatus("SENT", "SENT")).toBeNull();
    expect(nextStatus("QUEUED", "READ")).toBe("READ");
  });
  it("accepts a failure after SENT but ignores one that contradicts an earlier DELIVERED/READ", () => {
    expect(nextStatus("SENT", "BOUNCED")).toBe("BOUNCED");
    expect(nextStatus("SENT", "FAILED")).toBe("FAILED");
    expect(nextStatus("DELIVERED", "FAILED")).toBeNull();
    expect(nextStatus("READ", "BOUNCED")).toBeNull();
  });
  it("lets a later provider DELIVERED correct an earlier failure, but not a later SENT", () => {
    expect(nextStatus("FAILED", "DELIVERED")).toBe("DELIVERED");
    expect(nextStatus("FAILED", "SENT")).toBeNull();
  });
});

describe("follow-up automation guardrails", () => {
  const DAY = 86_400_000;
  const rule = { waitDays: 3, cooldownDays: 3, maxRepeats: 2 };
  it("ships every rule disabled", () => {
    for (const r of Object.values(FOLLOWUP_RULE_DEFAULTS)) expect(r.enabled).toBe(false);
  });
  it("waits, then repeats on the cooldown, then stops at maxRepeats", () => {
    expect(repeatIndex(2 * DAY, rule)).toBeNull();
    expect(repeatIndex(3 * DAY, rule)).toBe(0);
    expect(repeatIndex(5 * DAY, rule)).toBe(0);
    expect(repeatIndex(6 * DAY, rule)).toBe(1);
    expect(repeatIndex(9 * DAY, rule)).toBeNull(); // repeat 2 would exceed maxRepeats=2
    expect(repeatIndex(400 * DAY, rule)).toBeNull(); // never indefinitely
  });
  it("validates rules strictly", () => {
    expect(() => validateFollowUpRule("nope", {})).toThrow(/Unknown/);
    expect(() => validateFollowUpRule("proposal-no-response", null)).toThrow();
    expect(() => validateFollowUpRule("proposal-no-response", { waitDays: 0 })).toThrow();
    expect(() => validateFollowUpRule("proposal-no-response", { maxRepeats: 99 })).toThrow();
    expect(() => validateFollowUpRule("verification-stalled", { notifyUser: true })).toThrow(/Only the proposal reminder/);
    expect(() => validateFollowUpRule("proposal-no-response", { enabled: true, createTask: false, notifyUser: false })).toThrow();
    expect(validateFollowUpRule("proposal-no-response", { enabled: true, notifyUser: true }).trigger).toBe("PROPOSAL_NO_RESPONSE");
    // the trigger of a rule key cannot be changed through the payload
    expect(validateFollowUpRule("profile-incomplete", { trigger: "PROPOSAL_NO_RESPONSE" } as never).trigger).toBe("PROFILE_INCOMPLETE");
  });
});

describe("internal-comment and thread visibility", () => {
  const manager = { id: "m", permissions: ["communications:view", "communications:logs:view", "sensitive:communication:view"] };
  const staff = { id: "s", permissions: ["communications:view"] };
  const nobody = { id: "n", permissions: [] as string[] };
  it("applicants and family members see PUBLIC_TO_USER only", () => {
    expect(userCanSee("PUBLIC_TO_USER")).toBe(true);
    for (const v of ["INTERNAL_ONLY", "STAFF_SHARED", "MANAGER_ONLY"] as const) expect(userCanSee(v)).toBe(false);
  });
  it("staff visibility follows the level; internal notes are the author's or a log-viewer's", () => {
    expect(staffCanSee("INTERNAL_ONLY", staff, "s")).toBe(true);
    expect(staffCanSee("INTERNAL_ONLY", staff, "someone-else")).toBe(false);
    expect(staffCanSee("INTERNAL_ONLY", manager, "someone-else")).toBe(true);
    expect(staffCanSee("STAFF_SHARED", staff, "x")).toBe(true);
    expect(staffCanSee("MANAGER_ONLY", staff, "x")).toBe(false);
    expect(staffCanSee("MANAGER_ONLY", manager, "x")).toBe(true);
    for (const v of ["PUBLIC_TO_USER", "STAFF_SHARED", "INTERNAL_ONLY", "MANAGER_ONLY"] as const) expect(staffCanSee(v, nobody, "n")).toBe(false);
  });
  it("flags free text that contains an e-mail address or a phone number", () => {
    expect(containsContactPattern("write to me at a.b@example.com")).toBe(true);
    expect(containsContactPattern("call +92 300 1234567")).toBe(true);
    expect(containsContactPattern("0300-1234567")).toBe(true);
    expect(containsContactPattern("Your proposal PRP-2026-000123 is ready at 10:30")).toBe(false);
  });
});

describe("encryption at rest", () => {
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret-for-communication-crypto-0123456789");
  it("round-trips, uses a random IV, and rejects tampering", () => {
    const a = encryptText("private message");
    const b = encryptText("private message");
    expect(a).not.toBe(b);
    expect(a).not.toContain("private");
    expect(isEncryptedToken(a)).toBe(true);
    expect(decryptText(a)).toBe("private message");
    const parts = a.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptText(parts.join("."))).toThrow();
    expect(isEncryptedToken("plain text")).toBe(false);
  });
  it("packs message content encrypted and still reads legacy plaintext bodies", () => {
    const packed = packContent({ subject: "Hi", text: "Body text", html: null, params: [] });
    expect(packed).not.toContain("Body text");
    expect(unpackContent(packed, true)).toMatchObject({ subject: "Hi", text: "Body text" });
    expect(readableText(packed, true, null)).toBe("Body text");
    expect(readableText("legacy body", false, null)).toBe("legacy body");
    expect(readableText(null, true, new Date())).toBeNull();
    expect(unpackContent(null, true)).toBeNull();
  });
});

describe("environments", () => {
  it("derives the environment from APP_ENV, then the platform", () => {
    expect(currentEnvironment({ APP_ENV: "production" })).toBe("PRODUCTION");
    expect(currentEnvironment({ APP_ENV: "staging" })).toBe("STAGING");
    expect(currentEnvironment({ APP_ENV: "sandbox" })).toBe("SANDBOX");
    expect(currentEnvironment({ VERCEL_ENV: "production" })).toBe("PRODUCTION");
    expect(currentEnvironment({ VERCEL_ENV: "preview" })).toBe("STAGING");
    expect(currentEnvironment({ NODE_ENV: "production" })).toBe("PRODUCTION");
    expect(currentEnvironment({ NODE_ENV: "development" })).toBe("DEVELOPMENT");
    expect(currentEnvironment({})).toBe("DEVELOPMENT");
  });
  it("matches test recipients across formatting and warns outside production only", () => {
    expect(isTestRecipient("+92 300 0000000", { COMMUNICATION_TEST_RECIPIENTS: "+923000000000,qa@x.com" })).toBe(true);
    expect(isTestRecipient("QA@X.com", { COMMUNICATION_TEST_RECIPIENTS: "qa@x.com" })).toBe(true);
    expect(isTestRecipient("other@x.com", { COMMUNICATION_TEST_RECIPIENTS: "qa@x.com" })).toBe(false);
    expect(isTestRecipient("qa@x.com", {})).toBe(false);
    expect(testModeWarning({ APP_ENV: "production" })).toBeNull();
    expect(testModeWarning({ APP_ENV: "staging" })).toMatch(/STAGING/);
  });
});

describe("message classes and purposes", () => {
  it("separates marketing from transactional and security", () => {
    expect(messageClassOf("SECURITY")).toBe("security");
    expect(messageClassOf("VERIFICATION")).toBe("security");
    expect(messageClassOf("PROPOSAL")).toBe("transactional");
    for (const t of CLASS_MESSAGE_TYPES.marketing) expect(messageClassOf(t)).toBe("marketing");
    // every message type belongs to exactly one class
    const all = Object.values(CLASS_MESSAGE_TYPES).flat();
    expect(new Set(all).size).toBe(all.length);
  });
  it("never lets a transactional type carry the MARKETING purpose", () => {
    for (const [type, purposes] of Object.entries(ALLOWED_PURPOSES)) {
      if (messageClassOf(type as never) !== "marketing") expect(purposes, type).not.toContain("MARKETING");
    }
  });
});

describe("policy configuration validation", () => {
  it("rejects nonsense limits and quiet hours", () => {
    expect(() => validatePolicyConfig("FREQUENCY", { transactional: { perHour: -1, perDay: 5, perWeek: 5 } })).toThrow();
    expect(() => validatePolicyConfig("QUIET_HOURS", { enabled: true, start: "25:00", end: "08:00", timezone: "UTC" })).toThrow();
    expect(() => validatePolicyConfig("QUIET_HOURS", { enabled: true, start: "21:00", end: "08:00", timezone: "Not/AZone" })).toThrow();
    expect(() => validatePolicyConfig("NOPE", {})).toThrow();
  });
  it("accepts a sensible configuration", () => {
    expect(() => validatePolicyConfig("QUIET_HOURS", { enabled: true, start: "21:00", end: "08:00", timezone: "Asia/Karachi" })).not.toThrow();
  });
});

describe("provider health and alerts", () => {
  it("derives health from consecutive failures", () => {
    expect(healthFromCounters(0, new Date())).toBe("HEALTHY");
    expect(healthFromCounters(0, null)).toBe("UNKNOWN");
    expect(["DEGRADED", "DOWN"]).toContain(healthFromCounters(3, new Date()));
    expect(healthFromCounters(50, new Date())).toBe("DOWN");
  });
  it("raises the spec's alert codes", () => {
    const base = { active: true, healthStatus: "HEALTHY" as const, failureRate24h: 0, sent24h: 100, failed24h: 0, lastError: null, lastWebhookAt: new Date() };
    expect(providerAlerts(base)).toEqual([]);
    expect(providerAlerts({ ...base, healthStatus: "DOWN" })).toContain("PROVIDER_DOWN");
    expect(providerAlerts({ ...base, failureRate24h: 0.5, failed24h: 50 })).toContain("HIGH_FAILURE_RATE");
    expect(providerAlerts({ ...base, lastError: "PROVIDER_AUTHENTICATION_FAILED" })).toContain("AUTHENTICATION_FAILURE");
    expect(providerAlerts({ ...base, active: false, healthStatus: "DOWN" })).toEqual([]);
  });
});

describe("analytics helpers", () => {
  it("computes percentiles and bounds the date range", () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
    expect(percentile([5], 50)).toBe(5);
    const r = parseAnalyticsRange("2000-01-01", "2026-01-01");
    expect(r.to.getTime() - r.from.getTime()).toBeLessThanOrEqual(366 * 86_400_000);
    const d = parseAnalyticsRange(null, null, new Date("2026-03-01T00:00:00Z"));
    expect(d.to.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(Math.round((d.to.getTime() - d.from.getTime()) / 86_400_000)).toBe(30);
  });
  it("exports CSV that neutralises spreadsheet formulas and carries no identifiers", () => {
    const a = {
      period: { from: "a", to: "b" },
      totals: { messages: 1, sent: 1, delivered: 0, read: 0, failed: 0, bounced: 0, rejected: 0, cancelledOrBlocked: 0, queued: 0, deadLettered: 0, sandboxOnly: 0 },
      rates: { deliveryRateOfReported: null, failureRate: null, bounceRate: null, readRateOfDelivered: null },
      latency: { avgSecondsToSent: null, p95SecondsToSent: null, samples: 0 },
      byChannel: {},
      byProvider: {},
      byMessageType: { "=HYPERLINK(1)": 1 },
      byTemplate: [],
      suppressions: { added: 0, active: 0 },
      followUps: { created: 0, completed: 0, completionRate: null },
      threads: { open: 0, withUserReply: 0, replyRate: null },
      blockedByReason: {},
      generatedAt: "now",
    } as CommunicationAnalytics;
    const csv = analyticsToCsv(a);
    expect(csv.startsWith("section,metric,value\n")).toBe(true);
    expect(csv).toContain(",'=HYPERLINK(1),");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });
});

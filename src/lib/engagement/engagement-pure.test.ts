import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/ops/feature-flags", () => ({ isFeatureEnabled: vi.fn(async () => false) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => undefined) }));

import { ACTION_PHRASES, JOURNEY_DISCLAIMER, JOURNEY_LABELS, JOURNEY_NOTE, NEXT_ACTION_DISCLAIMER, hasPressureWording } from "./phrases";
import { activityBand, computeActivityScore, daysSince } from "./activity-score";
import { computeJourney } from "./journey";
import { computeNextActions } from "./next-action";
import { conditionsMatch, profileMayReceiveEngagement, stillNeeded } from "./eligibility";
import { decideFrequency, isWithinQuietHours, nextQuietHoursEnd } from "./preflight-core";
import { REMINDER_KINDS, REMINDER_NOTIFICATION, ENGAGEMENT_NOTIFICATION_TYPES, USER_ACTIVITY_EVENTS, KIND_SATISFIED_BY } from "./constants";
import { scanEngagementContent } from "./content-scan";
import { buildEventKey, sanitizePayload } from "./events";
import { parseTargeting } from "./announcement-service";
import { REFERRAL_STATUS_LABELS } from "./referral-extension";
import { REMINDER_DRAFTS, CONTENT_TOPICS, buildEngagementAssist } from "@/lib/ai/analysis/engagement-assistant";
import { validateSettingsPatch, validatePreferencePatch } from "./settings";
import { safeRate } from "@/lib/reports/sample-size";
import { DEFAULT_TEMPLATES } from "@/lib/notifications/default-templates";
import { classify } from "@/lib/notifications/classification";
import { describeNotification } from "@/lib/communications/classify";
import { ROLE_PERMISSIONS } from "@/lib/permissions";
import { FEATURE_FLAG_DEFAULTS, FEATURE_FLAG_DEFS } from "@/lib/ops/feature-flag-defs";
import type { EngagementSnapshot } from "./types";

function snap(over: Partial<EngagementSnapshot> = {}): EngagementSnapshot {
  return {
    now: new Date("2026-10-05T07:00:00Z"), language: "EN",
    profile: { status: "ACTIVE", verified: false, completion: 60, createdAt: new Date("2026-09-01"), softDeleted: false },
    missingSections: ["Family", "Lifestyle"], hasPhoto: true, hasPartnerRequirements: true,
    verification: { status: "VERIFICATION_PENDING", requestedInfoCount: 0 },
    proposals: { total: 0, awaitingMyResponse: 0, responded: 0, received: 0 },
    meetings: { awaitingConfirmation: 0, scheduled: 0, completed: 0, completedAwaitingFollowup: 0 },
    membership: { status: null, endsAt: null }, openCases: 0, hasNotificationPreferences: true, lastActivityAt: new Date("2026-10-01"), crmStage: null,
    recentSupportInteractions: 0, completedTasksRatio: null,
    ...over,
  };
}

describe("wording: nothing the layer says contains pressure, scarcity, fear or outcome promises", () => {
  it("detects pressure wording in English, Roman-Urdu-style English and Urdu", () => {
    for (const bad of ["Act now or you will lose your chance", "Last chance to reply", "Hurry, only 2 left", "We guarantee a perfect match", "Your soulmate is waiting", "جلدی کریں", "آخری موقع", "گارنٹی کے ساتھ رشتہ", "Everyone else has already replied", "This is urgent"]) {
      expect(hasPressureWording(bad), bad).toBe(true);
      expect(scanEngagementContent({ texts: [{ field: "t", text: bad }] }).pass, bad).toBe(false);
    }
  });

  it("does not flag calm wording", () => {
    for (const ok of ["Your profile has a few sections you can finish whenever you are ready.", "A proposal is waiting for you to review. Take the time you need.", "آپ کی پروفائل کے کچھ حصے باقی ہیں، جب سہولت ہو مکمل کر لیجیے۔"]) expect(hasPressureWording(ok), ok).toBe(false);
  });

  it("every next-action phrase, journey label, note and disclaimer is calm in both languages", () => {
    const texts: string[] = [];
    for (const p of Object.values(ACTION_PHRASES)) for (const lang of ["EN", "UR"] as const) texts.push(p.title[lang], p.reason({ items: "Family, Education", count: 2 })[lang]);
    for (const lang of ["EN", "UR"] as const) {
      texts.push(...Object.values(JOURNEY_LABELS[lang]), ...Object.values(JOURNEY_NOTE[lang]), JOURNEY_DISCLAIMER[lang], NEXT_ACTION_DISCLAIMER[lang]);
      for (const list of Object.values(REMINDER_DRAFTS[lang])) texts.push(...list);
    }
    texts.push(...CONTENT_TOPICS);
    expect(texts.length).toBeGreaterThan(60);
    for (const t of texts) expect(hasPressureWording(t), t).toBe(false);
    // and none of them make an outcome claim
    for (const t of texts) expect(/\b(will (get )?married|best match|you will find|likely to|chances of)\b/i.test(t), t).toBe(false);
  });

  it("the engagement notification templates are calm, bilingual and never urgent", () => {
    for (const type of ENGAGEMENT_NOTIFICATION_TYPES) {
      const t = DEFAULT_TEMPLATES[type];
      expect(t, type).toBeDefined();
      for (const lang of ["EN", "UR"] as const) {
        const copy = t[lang];
        expect(copy.body.length, `${type} ${lang}`).toBeGreaterThan(10);
        expect(hasPressureWording(`${copy.title} ${copy.subject} ${copy.body}`), `${type} ${lang}`).toBe(false);
      }
      expect(classify(type).preferenceCategory, type).toBe("FOLLOWUP");
      expect(["LOW"]).toContain(describeNotification(type).priority);
    }
  });

  it("the referral status wording never accuses and never names the referred person", () => {
    for (const label of Object.values(REFERRAL_STATUS_LABELS)) {
      expect(/fraud|suspicious|abuse|cheat|fake|scam|blocked/i.test(label.EN)).toBe(false);
      expect(label.UR.length).toBeGreaterThan(2);
    }
  });
});

describe("next actions and journey", () => {
  it("lists only what is open, in a stable order, with no urgency", () => {
    const actions = computeNextActions(snap({ proposals: { total: 1, awaitingMyResponse: 1, responded: 0, received: 1 } }));
    expect(actions[0].key).toBe("RESPOND_TO_PROPOSAL");
    expect(actions.map((a) => a.order)).toEqual(actions.map((_, i) => i + 1));
    expect(actions.some((a) => a.key === "COMPLETE_PROFILE")).toBe(true);
    for (const a of actions) expect(hasPressureWording(`${a.title} ${a.reason}`)).toBe(false);
  });

  it("offers nothing for a closed, suspended or deleted account and never suggests a decision", () => {
    expect(computeNextActions(snap({ profile: { status: "SUSPENDED", verified: false, completion: 10, createdAt: new Date(), softDeleted: false } }))).toEqual([]);
    expect(computeNextActions(snap({ profile: { status: "ACTIVE", verified: true, completion: 10, createdAt: new Date(), softDeleted: true } }))).toEqual([]);
    const all = computeNextActions(snap({ proposals: { total: 1, awaitingMyResponse: 1, responded: 0, received: 1 }, meetings: { awaitingConfirmation: 1, scheduled: 0, completed: 1, completedAwaitingFollowup: 1 } }));
    for (const a of all) expect(/\b(accept|decline|reject|marry|choose (a|this|the) (match|proposal|partner))\b/i.test(`${a.title} ${a.reason}`)).toBe(false);
  });

  it("is available in Urdu", () => {
    const actions = computeNextActions(snap({ language: "UR" }));
    expect(actions[0].title).toMatch(/[؀-ۿ]/);
  });

  it("the journey describes state only: completed / in progress / not started", () => {
    const j = computeJourney(snap());
    expect(j.stages.map((s) => s.key)).toEqual(["REGISTRATION", "PROFILE", "VERIFICATION", "MATCHING", "PROPOSAL", "MEETING", "FOLLOW_UP"]);
    expect(j.stages.every((s) => ["COMPLETED", "IN_PROGRESS", "NOT_STARTED"].includes(s.state))).toBe(true);
    expect(j.stages[0].state).toBe("COMPLETED");
    expect(hasPressureWording(j.disclaimer)).toBe(false);
  });
});

describe("activity measure", () => {
  it("is bounded, bands are neutral, and the note says it is not a quality measure", () => {
    const s = computeActivityScore(snap());
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
    expect(activityBand(null, 14, 30)).toBe("ACTIVE");
    expect(activityBand(15, 14, 30)).toBe("LOW_ACTIVITY");
    expect(activityBand(31, 14, 30)).toBe("INACTIVE");
    expect(daysSince(new Date("2026-10-01"), new Date("2026-10-05"))).toBe(4);
  });
});

describe("quiet hours and frequency limits", () => {
  it("handles windows that span midnight, plain windows, and 'no window'", () => {
    const tz = "Asia/Karachi"; // UTC+5
    expect(isWithinQuietHours(new Date("2026-10-04T19:00:00Z"), tz, 22, 8)).toBe(true); // 00:00 local
    expect(isWithinQuietHours(new Date("2026-10-04T07:00:00Z"), tz, 22, 8)).toBe(false); // 12:00 local
    expect(isWithinQuietHours(new Date("2026-10-04T17:30:00Z"), tz, 22, 8)).toBe(true); // 22:30 local
    expect(isWithinQuietHours(new Date("2026-10-04T07:00:00Z"), tz, 12, 14)).toBe(true);
    expect(isWithinQuietHours(new Date("2026-10-04T19:00:00Z"), tz, 9, 9)).toBe(false);
    expect(isWithinQuietHours(new Date("2026-10-04T19:00:00Z"), "Not/AZone", 22, 8)).toBeTypeOf("boolean");
  });

  it("a deferred reminder is moved to the end of the quiet window, in the applicant's time zone", () => {
    const end = nextQuietHoursEnd(new Date("2026-10-04T19:10:00Z"), "Asia/Karachi", 22, 8);
    expect(isWithinQuietHours(end, "Asia/Karachi", 22, 8)).toBe(false);
    expect(end.getTime() - new Date("2026-10-04T19:10:00Z").getTime()).toBeLessThanOrEqual(9 * 3_600_000);
  });

  it("limits apply in order: attempts end it, everything else only defers", () => {
    const limits = { dailyMax: 3, weeklyReengagementMax: 2, minGapHours: 24, maxAttempts: 3 };
    const base = { sentToday: 0, reengagementSentThisWeek: 0, hoursSinceLastSameKind: null, priorAttemptsForKind: 0, isReengagement: true };
    expect(decideFrequency(base, limits)).toEqual({ ok: true });
    expect(decideFrequency({ ...base, priorAttemptsForKind: 3 }, limits)).toMatchObject({ ok: false, action: "EXPIRE" });
    expect(decideFrequency({ ...base, sentToday: 3 }, limits)).toMatchObject({ action: "DEFER", reason: "DAILY_LIMIT_REACHED" });
    expect(decideFrequency({ ...base, hoursSinceLastSameKind: 5 }, limits)).toMatchObject({ action: "DEFER", reason: "MIN_GAP_NOT_ELAPSED" });
    expect(decideFrequency({ ...base, reengagementSentThisWeek: 2 }, limits)).toMatchObject({ action: "DEFER", reason: "WEEKLY_REENGAGEMENT_LIMIT_REACHED" });
    expect(decideFrequency({ ...base, isReengagement: false, reengagementSentThisWeek: 9 }, limits)).toEqual({ ok: true });
  });
});

describe("eligibility", () => {
  it("a reminder is only needed while the thing is still open", () => {
    expect(stillNeeded("PROFILE_INCOMPLETE", snap())).toBe(true);
    expect(stillNeeded("PROFILE_INCOMPLETE", snap({ profile: { status: "ACTIVE", verified: false, completion: 100, createdAt: new Date(), softDeleted: false } }))).toBe(false);
    expect(stillNeeded("PROPOSAL_PENDING", snap())).toBe(false);
    expect(stillNeeded("PROPOSAL_PENDING", snap({ proposals: { total: 1, awaitingMyResponse: 1, responded: 0, received: 1 } }))).toBe(true);
    expect(stillNeeded("INACTIVITY", snap({ lastActivityAt: new Date("2026-06-01") }))).toBe(true);
    expect(stillNeeded("INACTIVITY", snap())).toBe(false);
    expect(stillNeeded("INACTIVITY", snap({ lastActivityAt: null }))).toBe(false); // no data => never assumed inactive
    expect(stillNeeded("MEMBERSHIP_EXPIRING", snap({ membership: { status: "ACTIVE", endsAt: new Date("2026-10-10") } }))).toBe(true);
    expect(stillNeeded("MEMBERSHIP_EXPIRING", snap({ membership: { status: "ACTIVE", endsAt: new Date("2027-10-10") } }))).toBe(false);
    expect(stillNeeded("MEMBERSHIP_EXPIRING", snap({ membership: { status: "CANCELLED", endsAt: new Date("2026-10-10") } }))).toBe(false);
  });

  it("conditions match on plain facts only", () => {
    expect(conditionsMatch({ completionLt: 100 }, snap()).match).toBe(true);
    expect(conditionsMatch({ completionLt: 50 }, snap())).toMatchObject({ match: false, failed: "COMPLETION_LT" });
    expect(conditionsMatch({ inactiveDaysGte: 30 }, snap())).toMatchObject({ match: false });
    expect(conditionsMatch({ language: "UR" }, snap())).toMatchObject({ match: false });
    expect(conditionsMatch({ stageIn: ["ACTIVE"] }, snap({ crmStage: "ACTIVE" })).match).toBe(true);
    expect(conditionsMatch({ stageIn: ["ACTIVE"] }, snap({ crmStage: null })).match).toBe(false);
  });

  it("closed, suspended or deleted accounts never receive engagement messages", () => {
    for (const status of ["SUSPENDED", "ARCHIVED", "REJECTED", "MARRIED", "FINALIZED", "NOT_INTERESTED"] as const) expect(profileMayReceiveEngagement(snap({ profile: { status, verified: true, completion: 50, createdAt: new Date(), softDeleted: false } })).ok).toBe(false);
    expect(profileMayReceiveEngagement(snap({ profile: { status: "ACTIVE", verified: true, completion: 50, createdAt: new Date(), softDeleted: true } })).ok).toBe(false);
    expect(profileMayReceiveEngagement(snap()).ok).toBe(true);
  });
});

describe("constants and invariants", () => {
  it("every reminder maps to an engagement notification type and a satisfied-by list", () => {
    for (const k of REMINDER_KINDS) {
      expect(ENGAGEMENT_NOTIFICATION_TYPES).toContain(REMINDER_NOTIFICATION[k]);
      expect(Array.isArray(KIND_SATISFIED_BY[k])).toBe(true);
    }
  });

  it("system events are not counted as the applicant being active", () => {
    for (const e of ["PROPOSAL_RECEIVED", "MEMBERSHIP_EXPIRING", "INACTIVE_USER", "REENGAGEMENT_ELIGIBLE", "MEETING_REQUESTED", "FOLLOWUP_DUE"] as const) expect(USER_ACTIVITY_EVENTS).not.toContain(e);
    expect(USER_ACTIVITY_EVENTS).toContain("LOGIN");
  });

  it("event keys: once-per-profile, one login per day, source-keyed otherwise", () => {
    expect(buildEventKey("USER_REGISTERED", "p", "a")).toBe(buildEventKey("USER_REGISTERED", "p", "b"));
    expect(buildEventKey("LOGIN", "p", undefined, new Date("2026-10-05T01:00:00Z"))).toBe(buildEventKey("LOGIN", "p", undefined, new Date("2026-10-05T23:00:00Z")));
    expect(buildEventKey("LOGIN", "p", undefined, new Date("2026-10-05T01:00:00Z"))).not.toBe(buildEventKey("LOGIN", "p", undefined, new Date("2026-10-06T01:00:00Z")));
    expect(buildEventKey("PROPOSAL_RECEIVED", "p", "x")).not.toBe(buildEventKey("PROPOSAL_RECEIVED", "p", "y"));
  });

  it("event payloads keep only safe, short, scalar values", () => {
    expect(sanitizePayload({ count: 3, ok: true, status: "NEW", email: "a@b.c", phone: "123", fullName: "A B", note: "x", score: 9, "bad key": 1, long: "x".repeat(80), nested: { a: 1 }, text: "<script>" })).toEqual({ count: 3, ok: true, status: "NEW" });
    expect(sanitizePayload({ email: "a@b.c" })).toBeUndefined();
  });

  it("the engagement flags all default OFF and the permission invariants hold", () => {
    const flags = FEATURE_FLAG_DEFS.filter((d) => d.key.startsWith("engagement.") || d.key === "ai.engagement_assistant.enabled");
    expect(flags.length).toBeGreaterThanOrEqual(8);
    for (const f of flags) expect(FEATURE_FLAG_DEFAULTS[f.key], f.key).toBe(false);
    const engagement = (role: keyof typeof ROLE_PERMISSIONS) => ROLE_PERMISSIONS[role].filter((p) => p.startsWith("engagement:"));
    for (const p of engagement("COMMUNICATION_STAFF")) expect(ROLE_PERMISSIONS.COMMUNICATION_MANAGER, p).toContain(p);
    for (const p of ["engagement:approve", "engagement:manage", "engagement:workflows:publish", "engagement:content:publish", "engagement:announcements:publish", "engagement:analytics:export"] as const) expect(ROLE_PERMISSIONS.COMMUNICATION_STAFF, p).not.toContain(p);
    expect(engagement("REPORTING_ANALYST").sort()).toEqual(["engagement:analytics:view", "engagement:view"]);
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      if (["SUPER_ADMIN", "OPERATIONS_ADMIN", "COMMUNICATION_MANAGER", "COMMUNICATION_STAFF", "REPORTING_ANALYST", "ADMIN"].includes(role)) continue;
      expect((perms as string[]).filter((p) => p.startsWith("engagement:")), role).toEqual([]);
    }
  });
});

describe("announcement targeting, settings and preferences", () => {
  it("targeting is a closed vocabulary: no sensitive attribute can be named", () => {
    expect(parseTargeting({ audience: "ALL" })).toEqual({ audience: "ALL" });
    expect(parseTargeting({ audience: "LIFECYCLE_STAGE", value: "ACTIVE" })).toEqual({ audience: "LIFECYCLE_STAGE", value: "ACTIVE" });
    expect(() => parseTargeting({ audience: "RELIGION", value: "x" })).toThrow();
    expect(() => parseTargeting({ audience: "ALL", religion: "x" })).toThrow();
    expect(() => parseTargeting({ audience: "ALL", value: "x" })).toThrow();
    expect(() => parseTargeting({ audience: "PACKAGE" })).toThrow();
    expect(() => parseTargeting({ audience: "LIFECYCLE_STAGE", value: "NOT_A_STAGE" })).toThrow();
    expect(() => parseTargeting(null)).toThrow();
  });

  it("admin limits are bounded and unknown fields are refused", () => {
    const current = { maxDailyNotifications: 5, maxWeeklyReengagement: 2, maxFollowupAttempts: 3, maxReengagementAttempts: 3, lowActivityAfterDays: 14, inactiveAfterDays: 30, reengagementCooldownDays: 14, reminderMinGapHours: 24, quietHoursStart: 22, quietHoursEnd: 8, defaultTimezone: "Asia/Karachi" } as never;
    expect(validateSettingsPatch({ maxDailyNotifications: 3 }, current)).toEqual({ maxDailyNotifications: 3 });
    expect(() => validateSettingsPatch({ maxDailyNotifications: 9999 }, current)).toThrow();
    expect(() => validateSettingsPatch({ maxDailyNotifications: 0 }, current)).toThrow();
    expect(() => validateSettingsPatch({ inactiveAfterDays: 5 }, current)).toThrow(); // must exceed the low-activity threshold
    expect(() => validateSettingsPatch({ id: 2 }, current)).toThrow();
  });

  it("applicant preferences accept only their own switches", () => {
    expect(validatePreferencePatch({ remindersEnabled: false, quietHoursStart: 21 })).toEqual({ remindersEnabled: false, quietHoursStart: 21 });
    expect(() => validatePreferencePatch({ profileId: "someone-else" })).toThrow();
    expect(() => validatePreferencePatch({ quietHoursStart: 30 })).toThrow();
    expect(() => validatePreferencePatch({ timezone: "Mars/Olympus" })).toThrow();
    expect(() => validatePreferencePatch({ maxDailyNotifications: 500 })).toThrow();
  });

  it("rates are never shown on a tiny sample", () => {
    expect(safeRate(2, 3)).toBeNull();
    expect(safeRate(5, 10)).toBe(50);
  });
});

describe("assistant output", () => {
  it("is labelled, bilingual, free of pressure wording and makes no prediction", () => {
    for (const mode of ["REMINDER_DRAFT", "CONTENT_SUGGESTION"] as const) {
      for (const language of ["EN", "UR"] as const) {
        const out = buildEngagementAssist({ mode, language, reminderKind: "INACTIVITY" });
        const suggestions = (out.data?.suggestions as string[]) ?? [];
        expect(suggestions.length, `${mode} ${language}`).toBeGreaterThan(0);
        for (const s of suggestions) expect(hasPressureWording(s), s).toBe(false);
        expect(out.data?.reviewLabel).toMatch(/Human Review Required/);
        expect(out.limitations.join(" ")).toMatch(/does not measure quality|cannot send/);
      }
    }
    const journey = buildEngagementAssist({ mode: "JOURNEY_SUMMARY", snapshot: snap() });
    expect(journey.summary).not.toMatch(/likely|probab|predict|will marry/i);
  });

  it("reports honestly when there is nothing to summarise", () => {
    expect(buildEngagementAssist({ mode: "FEEDBACK_SUMMARY", feedback: { total: 0, byType: {}, byStatus: {} } }).summary).toMatch(/No feedback/);
    expect(buildEngagementAssist({ mode: "JOURNEY_SUMMARY" }).missingInformation.length).toBeGreaterThan(0);
  });
});

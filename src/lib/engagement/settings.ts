import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { engagementAudit } from "@/lib/engagement/audit";
import type { EngagementPreference, EngagementSettings } from "@prisma/client";

// STEP 30 — admin-configurable limits (singleton) and per-applicant engagement preferences. No universal limit is hard-coded
// in the sending path: everything reads these rows (the schema defaults are only the first-run values).

export const SETTINGS_BOUNDS = {
  maxDailyNotifications: [1, 50],
  maxWeeklyReengagement: [0, 14],
  maxFollowupAttempts: [0, 10],
  maxReengagementAttempts: [0, 10],
  lowActivityAfterDays: [1, 365],
  inactiveAfterDays: [2, 730],
  reengagementCooldownDays: [1, 365],
  reminderMinGapHours: [1, 720],
  quietHoursStart: [0, 23],
  quietHoursEnd: [0, 23],
} as const;

export type SettingsPatch = Partial<Pick<EngagementSettings, keyof typeof SETTINGS_BOUNDS | "defaultTimezone">>;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function getEngagementSettings(): Promise<EngagementSettings> {
  const row = await prisma.engagementSettings.findUnique({ where: { id: 1 } });
  if (row) return row;
  return prisma.engagementSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

export function validateSettingsPatch(patch: Record<string, unknown>, current: EngagementSettings): SettingsPatch {
  const out: SettingsPatch = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "defaultTimezone") {
      if (typeof value !== "string" || !isValidTimeZone(value)) throw new HttpError(422, "Unknown time zone.");
      out.defaultTimezone = value;
      continue;
    }
    const bounds = (SETTINGS_BOUNDS as Record<string, readonly [number, number]>)[key];
    if (!bounds) throw new HttpError(422, `Unknown setting "${key}".`); // mass-assignment safe: only listed keys
    if (typeof value !== "number" || !Number.isInteger(value) || value < bounds[0] || value > bounds[1]) throw new HttpError(422, `${key} must be a whole number between ${bounds[0]} and ${bounds[1]}.`);
    (out as Record<string, number>)[key] = value;
  }
  const low = out.lowActivityAfterDays ?? current.lowActivityAfterDays;
  const inactive = out.inactiveAfterDays ?? current.inactiveAfterDays;
  if (inactive <= low) throw new HttpError(422, "The inactivity threshold must be larger than the low-activity threshold.");
  return out;
}

export async function updateEngagementSettings(actorId: string, patch: Record<string, unknown>, reason: string): Promise<EngagementSettings> {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const current = await getEngagementSettings();
  const clean = validateSettingsPatch(patch, current);
  if (Object.keys(clean).length === 0) throw new HttpError(422, "Nothing to change.");
  const updated = await prisma.engagementSettings.update({ where: { id: 1 }, data: { ...clean, updatedById: actorId } });
  await engagementAudit({ action: "ENGAGEMENT_SETTINGS_CHANGED", actorId, resource: "engagement_settings", resourceId: "1", before: pick(current, Object.keys(clean)), after: clean, reason });
  return updated;
}

function pick(obj: object, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, (obj as Record<string, unknown>)[k]]));
}

// ---------- applicant preferences ----------
export interface PreferencePatch {
  quietHoursEnabled?: boolean;
  quietHoursStart?: number | null;
  quietHoursEnd?: number | null;
  timezone?: string | null;
  maxDailyNotifications?: number | null;
  remindersEnabled?: boolean;
  reengagementEnabled?: boolean;
  feedbackRequestsEnabled?: boolean;
}

const BOOLEAN_KEYS = ["quietHoursEnabled", "remindersEnabled", "reengagementEnabled", "feedbackRequestsEnabled"] as const;

export function validatePreferencePatch(body: Record<string, unknown>): PreferencePatch {
  const out: PreferencePatch = {};
  for (const key of BOOLEAN_KEYS) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "boolean") throw new HttpError(400, `${key} must be true or false.`);
    out[key] = body[key] as boolean;
  }
  for (const key of ["quietHoursStart", "quietHoursEnd"] as const) {
    if (body[key] === undefined) continue;
    const v = body[key];
    if (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 23)) throw new HttpError(400, `${key} must be an hour between 0 and 23.`);
    out[key] = v as number | null;
  }
  if (body.timezone !== undefined) {
    if (body.timezone !== null && (typeof body.timezone !== "string" || !isValidTimeZone(body.timezone))) throw new HttpError(400, "Unknown time zone.");
    out.timezone = body.timezone as string | null;
  }
  if (body.maxDailyNotifications !== undefined) {
    const v = body.maxDailyNotifications;
    if (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 50)) throw new HttpError(400, "maxDailyNotifications must be between 1 and 50.");
    out.maxDailyNotifications = v as number | null;
  }
  const unknown = Object.keys(body).filter((k) => !(BOOLEAN_KEYS as readonly string[]).includes(k) && !["quietHoursStart", "quietHoursEnd", "timezone", "maxDailyNotifications"].includes(k));
  if (unknown.length) throw new HttpError(400, "Unknown preference field.");
  return out;
}

export async function getEngagementPreference(profileId: string): Promise<EngagementPreference | null> {
  return prisma.engagementPreference.findUnique({ where: { profileId } });
}

export async function updateEngagementPreference(profileId: string, body: Record<string, unknown>): Promise<EngagementPreference> {
  const patch = validatePreferencePatch(body);
  const row = await prisma.engagementPreference.upsert({ where: { profileId }, update: patch, create: { profileId, ...patch } });
  // A person switching reminders/re-engagement off must stop pending ones immediately, not at the next tick.
  if (patch.remindersEnabled === false || patch.reengagementEnabled === false) {
    await prisma.engagementReminder.updateMany({
      where: { profileId, state: { in: ["SCHEDULED", "ELIGIBLE"] } },
      data: { state: "OPTED_OUT", cancelledAt: new Date(), cancelReason: "APPLICANT_OPTED_OUT" },
    });
    if (patch.reengagementEnabled === false) await prisma.engagementProfileState.upsert({ where: { profileId }, update: { reengagementOptOut: true }, create: { profileId, reengagementOptOut: true } });
  }
  if (patch.reengagementEnabled === true) await prisma.engagementProfileState.updateMany({ where: { profileId }, data: { reengagementOptOut: false } });
  await engagementAudit({ action: "ENGAGEMENT_PREFERENCE_CHANGED", targetProfileId: profileId, resource: "engagement_preference", resourceId: profileId, after: patch });
  return row;
}

// Effective personal limits for one applicant: their own choice where set, otherwise the admin defaults.
export function effectiveLimits(settings: EngagementSettings, pref: EngagementPreference | null) {
  return {
    dailyMax: Math.min(settings.maxDailyNotifications, pref?.maxDailyNotifications ?? settings.maxDailyNotifications),
    // Quiet hours always apply to engagement messages (they are never time-critical): the applicant's own window when they
    // chose one, otherwise the admin default (an admin can disable the default by setting start = end).
    quiet: {
      start: pref?.quietHoursEnabled ? (pref.quietHoursStart ?? settings.quietHoursStart) : settings.quietHoursStart,
      end: pref?.quietHoursEnabled ? (pref.quietHoursEnd ?? settings.quietHoursEnd) : settings.quietHoursEnd,
      timezone: pref?.timezone ?? settings.defaultTimezone,
    },
  };
}

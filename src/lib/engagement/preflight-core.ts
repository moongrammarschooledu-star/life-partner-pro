// STEP 30 — the pure arithmetic of the "may we contact this person now?" gate: quiet hours and frequency limits. The database
// facts feed these functions; the functions decide. Kept pure so every edge (midnight-spanning windows, time zones, caps)
// is unit-tested.

export function localHour(now: Date, timeZone: string): number {
  try {
    const part = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone }).formatToParts(now).find((p) => p.type === "hour");
    const h = Number(part?.value);
    return Number.isFinite(h) ? h % 24 : now.getUTCHours();
  } catch {
    return now.getUTCHours(); // an unknown time zone must not block sending forever; fall back to UTC
  }
}

// Quiet hours [start, end) in whole local hours. start === end means "no quiet window". Windows may span midnight (22 -> 8).
export function isWithinQuietHours(now: Date, timeZone: string, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  const h = localHour(now, timeZone);
  return startHour < endHour ? h >= startHour && h < endHour : h >= startHour || h < endHour;
}

// The first whole hour (UTC-aligned to the hour) at which quiet hours are over; used as the new due time of a deferred reminder.
export function nextQuietHoursEnd(now: Date, timeZone: string, startHour: number, endHour: number): Date {
  const base = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  for (let i = 1; i <= 26; i++) {
    const t = new Date(base.getTime() + i * 3_600_000);
    if (!isWithinQuietHours(t, timeZone, startHour, endHour)) return t;
  }
  return new Date(now.getTime() + 24 * 3_600_000);
}

export interface FrequencyFacts {
  sentToday: number;
  reengagementSentThisWeek: number;
  hoursSinceLastSameKind: number | null;
  priorAttemptsForKind: number;
  isReengagement: boolean;
}

export interface FrequencyLimits {
  dailyMax: number;
  weeklyReengagementMax: number;
  minGapHours: number;
  maxAttempts: number;
}

export type FrequencyDecision =
  | { ok: true }
  | { ok: false; action: "DEFER"; reason: string; deferHours: number }
  | { ok: false; action: "EXPIRE"; reason: string };

// Order matters: an exhausted attempt budget ends the reminder for good (EXPIRE); every other limit only DEFERS it.
export function decideFrequency(f: FrequencyFacts, l: FrequencyLimits): FrequencyDecision {
  if (f.priorAttemptsForKind >= l.maxAttempts) return { ok: false, action: "EXPIRE", reason: "ATTEMPT_LIMIT_REACHED" };
  if (f.sentToday >= l.dailyMax) return { ok: false, action: "DEFER", reason: "DAILY_LIMIT_REACHED", deferHours: 24 };
  if (f.hoursSinceLastSameKind !== null && f.hoursSinceLastSameKind < l.minGapHours) return { ok: false, action: "DEFER", reason: "MIN_GAP_NOT_ELAPSED", deferHours: Math.max(1, Math.ceil(l.minGapHours - f.hoursSinceLastSameKind)) };
  if (f.isReengagement && f.reengagementSentThisWeek >= l.weeklyReengagementMax) return { ok: false, action: "DEFER", reason: "WEEKLY_REENGAGEMENT_LIMIT_REACHED", deferHours: 24 };
  return { ok: true };
}

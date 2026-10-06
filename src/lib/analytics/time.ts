// STEP 31 — business-timezone date handling for analytics. Pure (Intl only). A "day" is a calendar day in the configured business
// timezone, written as a "YYYY-MM-DD" key; the data mart stores that key as a UTC-midnight @db.Date. Existing /admin/reports
// stay UTC (unchanged); everything under src/lib/analytics uses this module.

export type PeriodPreset =
  | "TODAY" | "YESTERDAY" | "LAST_7_DAYS" | "LAST_30_DAYS" | "LAST_90_DAYS"
  | "THIS_MONTH" | "PREVIOUS_MONTH" | "THIS_QUARTER" | "PREVIOUS_QUARTER" | "THIS_YEAR" | "PREVIOUS_YEAR" | "CUSTOM";

export const PERIOD_PRESETS: PeriodPreset[] = [
  "TODAY", "YESTERDAY", "LAST_7_DAYS", "LAST_30_DAYS", "LAST_90_DAYS", "THIS_MONTH", "PREVIOUS_MONTH", "THIS_QUARTER", "PREVIOUS_QUARTER", "THIS_YEAR", "PREVIOUS_YEAR", "CUSTOM",
];

export type CompareMode = "NONE" | "PREVIOUS_PERIOD" | "SAME_PERIOD_LAST_YEAR";
export const COMPARE_MODES: CompareMode[] = ["NONE", "PREVIOUS_PERIOD", "SAME_PERIOD_LAST_YEAR"];

export interface Period {
  preset: PeriodPreset;
  fromDay: string; // inclusive, business-tz calendar day
  toDay: string; // inclusive
  startUtc: Date; // instant of the first day's local midnight
  endUtc: Date; // instant of local midnight AFTER the last day (exclusive bound)
  days: number;
  label: string;
}

export const MAX_PERIOD_DAYS = 1830;
const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface LocalParts { y: number; m: number; d: number; h: number; mi: number; s: number }
export function localParts(instant: Date, tz: string): LocalParts {
  const parts = formatter(tz).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export const keyOf = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

export function parseDayKey(key: string): { y: number; m: number; d: number } {
  const match = KEY.exec(key);
  if (!match) throw new Error(`Invalid day key: ${key}`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) throw new Error(`Invalid day key: ${key}`);
  return { y, m, d };
}

export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    parseDayKey(value);
    return true;
  } catch {
    return false;
  }
}

export function dayKey(instant: Date, tz: string): string {
  const p = localParts(instant, tz);
  return keyOf(p.y, p.m, p.d);
}

export function addDaysKey(key: string, n: number): string {
  const { y, m, d } = parseDayKey(key);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return keyOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function diffDays(fromKey: string, toKey: string): number {
  const a = parseDayKey(fromKey);
  const b = parseDayKey(toKey);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

export function eachDayKey(fromKey: string, toKey: string, limit = MAX_PERIOD_DAYS): string[] {
  const out: string[] = [];
  for (let k = fromKey; k <= toKey && out.length < limit; k = addDaysKey(k, 1)) out.push(k);
  return out;
}

// the stored @db.Date value for a day key (UTC midnight)
export function dayDate(key: string): Date {
  const { y, m, d } = parseDayKey(key);
  return new Date(Date.UTC(y, m - 1, d));
}

export function keyFromDbDate(date: Date): string {
  return keyOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

// the instant at which a calendar day starts in the given zone
export function dayStartUtc(key: string, tz: string): Date {
  const { y, m, d } = parseDayKey(key);
  const target = Date.UTC(y, m - 1, d, 0, 0, 0);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const p = localParts(new Date(guess), tz);
    const diff = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - target;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}

function labelOf(fromDay: string, toDay: string): string {
  const f = parseDayKey(fromDay);
  const t = parseDayKey(toDay);
  const one = (p: { y: number; m: number; d: number }) => `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
  return fromDay === toDay ? one(f) : `${one(f)} – ${one(t)}`;
}

function build(preset: PeriodPreset, fromDay: string, toDay: string, tz: string): Period {
  if (fromDay > toDay) throw new Error("The start of the range is after its end.");
  const days = diffDays(fromDay, toDay) + 1;
  if (days > MAX_PERIOD_DAYS) throw new Error(`The range is too long (max ${MAX_PERIOD_DAYS} days).`);
  return { preset, fromDay, toDay, startUtc: dayStartUtc(fromDay, tz), endUtc: dayStartUtc(addDaysKey(toDay, 1), tz), days, label: labelOf(fromDay, toDay) };
}

const monthStart = (y: number, m: number) => keyOf(y, m, 1);
function monthEnd(y: number, m: number): string {
  return keyOf(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
}
function shiftMonth(y: number, m: number, by: number): { y: number; m: number } {
  const t = new Date(Date.UTC(y, m - 1 + by, 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 };
}
const quarterStartMonth = (m: number) => Math.floor((m - 1) / 3) * 3 + 1;

export function resolvePeriod(preset: PeriodPreset, tz: string, now: Date = new Date(), custom?: { from?: string; to?: string }): Period {
  const today = dayKey(now, tz);
  const t = parseDayKey(today);
  switch (preset) {
    case "TODAY": return build(preset, today, today, tz);
    case "YESTERDAY": { const y = addDaysKey(today, -1); return build(preset, y, y, tz); }
    case "LAST_7_DAYS": return build(preset, addDaysKey(today, -6), today, tz);
    case "LAST_30_DAYS": return build(preset, addDaysKey(today, -29), today, tz);
    case "LAST_90_DAYS": return build(preset, addDaysKey(today, -89), today, tz);
    case "THIS_MONTH": return build(preset, monthStart(t.y, t.m), today, tz);
    case "PREVIOUS_MONTH": { const p = shiftMonth(t.y, t.m, -1); return build(preset, monthStart(p.y, p.m), monthEnd(p.y, p.m), tz); }
    case "THIS_QUARTER": return build(preset, monthStart(t.y, quarterStartMonth(t.m)), today, tz);
    case "PREVIOUS_QUARTER": {
      const q = shiftMonth(t.y, quarterStartMonth(t.m), -3);
      const e = shiftMonth(q.y, q.m, 2);
      return build(preset, monthStart(q.y, q.m), monthEnd(e.y, e.m), tz);
    }
    case "THIS_YEAR": return build(preset, keyOf(t.y, 1, 1), today, tz);
    case "PREVIOUS_YEAR": return build(preset, keyOf(t.y - 1, 1, 1), keyOf(t.y - 1, 12, 31), tz);
    case "CUSTOM": {
      if (!isDayKey(custom?.from) || !isDayKey(custom?.to)) throw new Error("A custom range needs a valid start and end date.");
      return build(preset, custom.from as string, custom.to as string, tz);
    }
  }
}

// The comparison window for a period. Calendar presets compare like with like (this month so far vs the same number of days of the
// previous month); rolling and custom ranges compare with the equal-length window immediately before.
export function resolveComparison(period: Period, mode: CompareMode, tz: string): Period | null {
  if (mode === "NONE") return null;
  if (mode === "SAME_PERIOD_LAST_YEAR") {
    const shift = (k: string) => {
      const { y, m, d } = parseDayKey(k);
      const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
      return keyOf(y - 1, m, Math.min(d, last));
    };
    return build("CUSTOM", shift(period.fromDay), shift(period.toDay), tz);
  }
  const f = parseDayKey(period.fromDay);
  switch (period.preset) {
    case "THIS_MONTH": case "PREVIOUS_MONTH": {
      const p = shiftMonth(f.y, f.m, -1);
      const fullEnd = monthEnd(p.y, p.m);
      const to = period.preset === "PREVIOUS_MONTH" ? fullEnd : [addDaysKey(monthStart(p.y, p.m), period.days - 1), fullEnd].sort()[0];
      return build("CUSTOM", monthStart(p.y, p.m), to, tz);
    }
    case "THIS_QUARTER": case "PREVIOUS_QUARTER": {
      const p = shiftMonth(f.y, f.m, -3);
      const end = shiftMonth(p.y, p.m, 2);
      const fullEnd = monthEnd(end.y, end.m);
      const to = period.preset === "PREVIOUS_QUARTER" ? fullEnd : [addDaysKey(monthStart(p.y, p.m), period.days - 1), fullEnd].sort()[0];
      return build("CUSTOM", monthStart(p.y, p.m), to, tz);
    }
    case "THIS_YEAR": case "PREVIOUS_YEAR": {
      const fullEnd = keyOf(f.y - 1, 12, 31);
      const to = period.preset === "PREVIOUS_YEAR" ? fullEnd : [addDaysKey(keyOf(f.y - 1, 1, 1), period.days - 1), fullEnd].sort()[0];
      return build("CUSTOM", keyOf(f.y - 1, 1, 1), to, tz);
    }
    default: {
      const to = addDaysKey(period.fromDay, -1);
      return build("CUSTOM", addDaysKey(to, -(period.days - 1)), to, tz);
    }
  }
}

// Percent change with one decimal. Null — shown as "Not available" — when there is nothing to compare against
// (missing or zero previous value): a percentage of zero is never displayed.
export function percentChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

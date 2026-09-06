import type { DateRangePreset, ResolvedDateRange } from "@/lib/reports/types";

// Deliberately UTC-based, not date-fns's local-timezone startOfDay/endOfDay —
// Vercel serverless functions run in UTC, and this must behave identically
// regardless of the host machine's local timezone (confirmed to matter: this
// dev machine's local TZ produced different day boundaries than UTC during
// testing). Matches the "hourUtc" convention already used in scheduler.ts.

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

function subUtcDays(d: Date, days: number): Date {
  return new Date(d.getTime() - days * 24 * 60 * 60 * 1000);
}

function startOfUtcYear(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
}

// Pure — no I/O. `now` defaults to the real current time so this stays
// testable without mocking global time.
export function resolveDateRange(preset: DateRangePreset, customFrom?: string | null, customTo?: string | null, now: Date = new Date()): ResolvedDateRange {
  let from: Date;
  let to: Date;

  switch (preset) {
    case "today":
      from = startOfUtcDay(now);
      to = endOfUtcDay(now);
      break;
    case "yesterday": {
      const yesterday = subUtcDays(now, 1);
      from = startOfUtcDay(yesterday);
      to = endOfUtcDay(yesterday);
      break;
    }
    case "7d":
      from = startOfUtcDay(subUtcDays(now, 6));
      to = endOfUtcDay(now);
      break;
    case "30d":
      from = startOfUtcDay(subUtcDays(now, 29));
      to = endOfUtcDay(now);
      break;
    case "90d":
      from = startOfUtcDay(subUtcDays(now, 89));
      to = endOfUtcDay(now);
      break;
    case "thisYear":
      from = startOfUtcYear(now);
      to = endOfUtcDay(now);
      break;
    case "custom":
      from = customFrom ? startOfUtcDay(new Date(customFrom)) : startOfUtcDay(subUtcDays(now, 29));
      to = customTo ? endOfUtcDay(new Date(customTo)) : endOfUtcDay(now);
      break;
    default:
      from = startOfUtcDay(subUtcDays(now, 29));
      to = endOfUtcDay(now);
  }

  // Previous period = the immediately preceding window of equal length
  // (spec §2's "previous-period comparison").
  const spanMs = to.getTime() - from.getTime();
  const previousTo = new Date(from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - spanMs);

  return { from, to, previousFrom, previousTo };
}

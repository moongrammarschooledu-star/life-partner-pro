import { rateLimit } from "@/lib/rate-limit";

// Pure — true if `hour` (0-23) falls within a quiet-hours window that may
// wrap past midnight (e.g. start=21, end=8 means 21:00-07:59 is quiet).
// Applied only to cron-triggered non-essential reminders, never to
// transactional/essential sends (spec §24).
export function isQuietHours(hour: number, start: number | null, end: number | null): boolean {
  if (start == null || end == null) return false;
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

// Reuses the existing in-memory rate limiter (src/lib/rate-limit.ts) rather
// than inventing a second limiting mechanism. One bucket per profile+channel
// per rolling 24h window.
export function checkDailyLimit(profileId: string, channel: string, maxPerDay: number): boolean {
  return rateLimit(`notify-daily:${channel}:${profileId}`, maxPerDay, 24 * 60 * 60 * 1000);
}

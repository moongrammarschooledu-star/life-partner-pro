// Quiet hours for push (STEP 37 §13). Pure. The window is hours of the day in the platform time zone; start == end means "no quiet hours", and a window
// that crosses midnight (22 → 7) is handled. Urgent and high-priority notices are never held back by it.

export function hourInZone(now: Date, timeZone: string): number {
  try {
    const h = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone }).format(now);
    return Number(h) % 24;
  } catch {
    return now.getUTCHours();
  }
}

export function inQuietHours(now: Date, start: number | null | undefined, end: number | null | undefined, timeZone: string): boolean {
  if (start == null || end == null || start === end) return false;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > 23 || end < 0 || end > 23) return false;
  const h = hourInZone(now, timeZone);
  return start < end ? h >= start && h < end : h >= start || h < end;
}

export function quietHoursApply(priority: string | null | undefined): boolean {
  return priority !== "HIGH" && priority !== "URGENT";
}
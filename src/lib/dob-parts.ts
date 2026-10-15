// Date of birth as three dropdowns (day / month / year) instead of the phone's date picker, which shows a US-style mm/dd/yyyy box that many people cannot use.
// The form still stores one ISO date string (yyyy-mm-dd), so the API, database and age checks are unchanged.

export interface DobParts {
  d: string;
  m: string;
  y: string;
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Splits "1996-04-09" into its parts; null when it is not a plain ISO date. */
export function splitDob(iso: string | null | undefined): DobParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!match) return null;
  return { y: match[1], m: String(Number(match[2])), d: String(Number(match[3])) };
}

export function daysInMonth(month: number, year: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The ISO date for the parts, or "" while a part is missing or the date does not exist (31 February). */
export function joinDob(parts: Partial<DobParts>): string {
  const d = Number(parts.d);
  const m = Number(parts.m);
  const y = Number(parts.y);
  if (!parts.d || !parts.m || !parts.y || !Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) return "";
  if (m < 1 || m > 12 || y < 1900 || d < 1 || d > daysInMonth(m, y)) return "";
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Birth years offered: from `minAge` years ago back to `maxAge` years ago, newest first. */
export function dobYears(now: Date = new Date(), minAge = 18, maxAge = 80): number[] {
  const thisYear = now.getUTCFullYear();
  const years: number[] = [];
  for (let y = thisYear - minAge; y >= thisYear - maxAge; y--) years.push(y);
  return years;
}

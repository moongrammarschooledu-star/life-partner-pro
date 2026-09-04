import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Parses a plain "YYYY-MM-DD" calendar date (from an <input type="date"> or
// any date-only string) as local midnight rather than UTC midnight. Passing
// such a string straight to `new Date(str)` interprets it as UTC, which
// silently shifts it to the previous calendar day in any timezone behind
// UTC (e.g. a follow-up due "tomorrow" showing as due "today", or a
// birthdate off by one day) — this is the fix for that whole class of bug.
export function parseDateOnly(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function calculateAge(dateOfBirth: Date | string): number {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

export function formatHeight(heightCm: number): string {
  const totalInches = heightCm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  return `${heightCm} cm (${feet}'${inches}")`;
}

export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return "Not disclosed";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
}

export function formatEnumLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Date-only values (dueDate, createdAt-as-a-calendar-date, etc.) are stored
// as UTC midnight (see parseDateOnly) — rendering must pin to UTC too, or a
// viewer behind UTC sees the previous day (the exact bug parseDateOnly was
// introduced to fix on the write side).
export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

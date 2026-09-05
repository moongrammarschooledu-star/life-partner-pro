import { randomInt } from "crypto";

// Pure helpers only — hashing (bcryptjs) and DB writes happen at the call
// site (src/app/api/verify/*/route.ts) so this stays unit-testable without
// touching the database. Never returns/logs the raw code anywhere but the
// caller's own console.log (the project-wide notification stub).

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function generateEmailToken(): string {
  // Longer, higher-entropy token for a clickable link rather than a
  // typed 6-digit code.
  const bytes = Array.from({ length: 24 }, () => randomInt(0, 256));
  return Buffer.from(bytes).toString("base64url");
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "*".repeat(digits.length);
  return `${phone.slice(0, phone.length - digits.length)}${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(1, local.length - 1))}@${domain}`;
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= expiresAt.getTime();
}

export function expiresInMinutes(minutes: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + minutes * 60_000);
}

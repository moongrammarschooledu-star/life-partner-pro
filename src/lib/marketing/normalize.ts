import { createHmac } from "crypto";
import { hashDestination } from "@/lib/communications/suppression-hash";

// STEP 29 §17 — one normaliser for lead identifiers, so suppression, lead dedup and applicant dedup all key on the
// same value. The existing STEP 28 normaliser only stripped non-digits, so "0300…" never matched "+92300…".

// Returns E.164 ("+923001234567") or null when the input cannot be a plausible phone number.
export function normalizePhoneE164(raw: string | null | undefined, defaultCountryCode = "92"): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  let digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;
  if (trimmed.startsWith("+")) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = defaultCountryCode + digits.slice(1); // national format 03xx…
  } else if (digits.length === 10 && digits.startsWith("3") && defaultCountryCode === "92") {
    digits = "92" + digits; // 3001234567 (national without trunk 0)
  }
  if (digits.length < 8 || digits.length > 15) return null;
  return "+" + digits;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v.length > 254 || !/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v)) return null;
  return v;
}

export function lastTenDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

export interface ContactHashes {
  phoneE164: string | null;
  email: string | null;
  phoneHash: string | null;
  emailHash: string | null;
  // Every plausible hash of the same destination, for suppression lookups: a suppression may have been recorded
  // against the raw address as typed elsewhere (STEP 25 hashes whatever string it was given).
  suppressionHashes: string[];
}

export function computeContactHashes(input: { phone?: string | null; email?: string | null }): ContactHashes {
  const phoneE164 = normalizePhoneE164(input.phone);
  const email = normalizeEmail(input.email);
  const hashes = new Set<string>();
  if (phoneE164) {
    hashes.add(hashDestination(phoneE164));
    const raw = input.phone!.trim();
    if (raw) hashes.add(hashDestination(raw));
    const last10 = lastTenDigits(phoneE164);
    if (last10) {
      hashes.add(hashDestination("0" + last10));
      hashes.add(hashDestination(last10));
    }
  }
  if (email) hashes.add(hashDestination(email));
  return {
    phoneE164,
    email,
    phoneHash: phoneE164 ? hashDestination(phoneE164) : null,
    emailHash: email ? hashDestination(email) : null,
    suppressionHashes: [...hashes],
  };
}

function ipSalt(): string {
  return process.env.RISK_HASH_SALT ?? process.env.NEXTAUTH_SECRET ?? "lpp-dev-marketing-ip-salt";
}

// Salted, truncated HMAC of a client IP (or any subject string). Raw IPs are never stored.
export function hashSubject(value: string): string {
  return createHmac("sha256", ipSalt()).update(value).digest("hex").slice(0, 40);
}

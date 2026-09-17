import { maskPhone, maskEmail } from "@/lib/verification/otp";

// Spec §35 — writeAudit() itself does zero masking (a caller responsibility,
// confirmed unchanged since it JSON.stringify's `meta` verbatim). This
// helper is used by new STEP 13 writeAudit() call sites that touch
// contact/export data; existing call sites are left as-is (forward-only,
// matching STEP 12's own precedent of adding new patterns without
// retrofitting ~90 existing ones).
const PHONE_KEYS = ["mobileNumber", "whatsappNumber", "phone"];
const EMAIL_KEYS = ["email"];

export function redactForAudit(meta: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === "string" && PHONE_KEYS.includes(key)) {
      redacted[key] = maskPhone(value);
    } else if (typeof value === "string" && EMAIL_KEYS.includes(key)) {
      redacted[key] = maskEmail(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

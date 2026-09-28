// Shared redaction for anything that is persisted as risk/security payload
// (SecurityEvent.meta, RiskEvidence.payload, RiskCaseEvent.payload). Keys that
// could carry contact details, credentials, documents or sensitive traits are
// dropped by NAME, and only scalar values survive — so a careless caller cannot
// leak a phone number or an OTP into the risk ledger.
export const SENSITIVE_KEY = /phone|mobile|whatsapp|email|password|pass\b|otp|code|token|secret|address|name|cnic|nic\b|document|photo|dob|birth|religion|income|ethnic|caste|health/i;

export function redactPayload(payload: Record<string, unknown> | undefined, maxValueLength = 200): Record<string, string | number | boolean> {
  const clean: Record<string, string | number | boolean> = {};
  if (!payload) return clean;
  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (typeof value === "string") clean[key] = value.slice(0, maxValueLength);
    else if (typeof value === "number" || typeof value === "boolean") clean[key] = value;
  }
  return clean;
}

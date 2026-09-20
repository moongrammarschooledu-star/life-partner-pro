// Privacy-first redaction (spec §13/§54). Pure, dependency-free, used by the
// logger, error capture and the alert webhook so monitoring can never become
// a data-leak channel. Key-based (structured data) + pattern-based (free text).

const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|otp|\bpin\b|cvv|card|api[-_]?key|signature|email|phone|mobile|whatsapp|address|income|iban|account[-_]?number|dob|birth|cnic|national/i;

const REDACTED = "[REDACTED]";

const PATTERNS: Array<[RegExp, string]> = [
  [/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgres://[REDACTED]"],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]"],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[REDACTED_JWT]"],
  [/\b(?:sk|pk|rk|whsec)_(?:live|test)?_?[A-Za-z0-9]{8,}\b/g, "[REDACTED_KEY]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]"],
  [/\+?\d[\d\s().-]{8,}\d/g, "[REDACTED_NUMBER]"],
];

export function redactString(input: string, maxLength = 500): string {
  let out = input;
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
  return out.length > maxLength ? `${out.slice(0, maxLength)}…` : out;
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 4) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactValue(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactValue(v, depth + 1);
    }
    return out;
  }
  return String(typeof value);
}

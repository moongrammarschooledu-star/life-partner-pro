import { redactString } from "@/lib/observability/redact";

// Typed configuration values (STEP 36 §5). A value is validated against its declared type before it is stored, and it must not look like a secret:
// secrets belong in the environment, and a setting can only carry the NAME of an environment variable (type SECRET_REFERENCE), never the value.

export const CONFIG_TYPES = ["STRING", "INTEGER", "DECIMAL", "BOOLEAN", "JSON", "ENUM", "URL", "SECRET_REFERENCE"] as const;
export type ConfigType = (typeof CONFIG_TYPES)[number];

export interface ValueSpec {
  type: ConfigType;
  min?: number;
  max?: number;
  maxLength?: number;
  enumValues?: readonly string[];
  /** For STRING values that may be empty (an unset optional detail). */
  allowEmpty?: boolean;
  pattern?: RegExp;
  patternMessage?: string;
}

export type ValueResult = { ok: true; value: unknown } | { ok: false; error: string };

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
// Shapes that are almost certainly credentials. Not a complete list: a second line of defence behind "never put a secret in a setting".
const SECRET_SHAPES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk_(live|test)_[A-Za-z0-9]{8,}/,
  /\b(?:rk|pk)_(live|test)_[A-Za-z0-9]{8,}/,
  /\bAKIA[0-9A-Z]{12,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JSON web token
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\b(?:xox[abp]|ghp|gho|github_pat)_[A-Za-z0-9_]{10,}/,
  /\bpostgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/i, // connection string with a password
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/, // a long unbroken token
];

export function looksLikeSecret(text: string): boolean {
  return SECRET_SHAPES.some((re) => re.test(text));
}

const URL_MAX = 300;

export function validateValue(spec: ValueSpec, raw: unknown): ValueResult {
  const bad = (error: string): ValueResult => ({ ok: false, error });
  switch (spec.type) {
    case "STRING": {
      if (typeof raw !== "string") return bad("Must be text.");
      const v = raw.trim();
      if (!v && !spec.allowEmpty) return bad("Must not be empty.");
      if (CONTROL_CHARS.test(v)) return bad("Contains characters that are not allowed.");
      if (v.length > (spec.maxLength ?? 200)) return bad(`Must be at most ${spec.maxLength ?? 200} characters.`);
      if (looksLikeSecret(v)) return bad("This looks like a secret. Keep secrets in the environment and store only a secret reference here.");
      if (v && spec.pattern && !spec.pattern.test(v)) return bad(spec.patternMessage ?? "Not in the expected format.");
      return { ok: true, value: v };
    }
    case "INTEGER": {
      if (typeof raw !== "number" || !Number.isInteger(raw)) return bad("Must be a whole number.");
      if (spec.min !== undefined && raw < spec.min) return bad(`Must be at least ${spec.min}.`);
      if (spec.max !== undefined && raw > spec.max) return bad(`Must be at most ${spec.max}.`);
      return { ok: true, value: raw };
    }
    case "DECIMAL": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return bad("Must be a number.");
      if (spec.min !== undefined && raw < spec.min) return bad(`Must be at least ${spec.min}.`);
      if (spec.max !== undefined && raw > spec.max) return bad(`Must be at most ${spec.max}.`);
      return { ok: true, value: raw };
    }
    case "BOOLEAN":
      return typeof raw === "boolean" ? { ok: true, value: raw } : bad("Must be true or false.");
    case "ENUM": {
      if (typeof raw !== "string" || !spec.enumValues?.includes(raw)) return bad(`Must be one of: ${spec.enumValues?.join(", ")}.`);
      return { ok: true, value: raw };
    }
    case "URL": {
      if (typeof raw !== "string") return bad("Must be a web address.");
      const v = raw.trim();
      if (!v && spec.allowEmpty) return { ok: true, value: "" };
      if (v.length > URL_MAX) return bad(`Must be at most ${URL_MAX} characters.`);
      try {
        const u = new URL(v);
        if (u.protocol !== "https:") return bad("Must start with https://");
        if (u.username || u.password) return bad("Must not contain a user name or password.");
        if (u.search && looksLikeSecret(u.search)) return bad("The address carries what looks like a secret.");
        return { ok: true, value: u.toString() };
      } catch {
        return bad("Not a valid web address.");
      }
    }
    case "SECRET_REFERENCE": {
      if (typeof raw !== "string" || !/^[A-Z][A-Z0-9_]{2,63}$/.test(raw.trim())) return bad("Must be the NAME of an environment variable (capital letters, digits and underscores), never the secret itself.");
      return { ok: true, value: raw.trim() };
    }
    case "JSON": {
      let text: string;
      try {
        text = JSON.stringify(raw);
      } catch {
        return bad("Not valid JSON.");
      }
      if (text === undefined) return bad("Not valid JSON.");
      if (text.length > (spec.maxLength ?? 5000)) return bad(`Too large (at most ${spec.maxLength ?? 5000} characters).`);
      if (depth(raw) > 5) return bad("Nested too deeply.");
      if (looksLikeSecret(text)) return bad("This looks like it contains a secret.");
      if (hasForbiddenKeys(raw)) return bad("Contains a key that is not allowed.");
      return { ok: true, value: JSON.parse(text) };
    }
  }
}

function depth(v: unknown, d = 0): number {
  if (v === null || typeof v !== "object") return d;
  return Math.max(d + 1, ...Object.values(v as Record<string, unknown>).map((x) => depth(x, d + 1)));
}

// Keys that would pollute an object's prototype if the value were ever merged into another object.
function hasForbiddenKeys(v: unknown): boolean {
  if (v === null || typeof v !== "object") return false;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") return true;
    if (hasForbiddenKeys(x)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- redaction for history and exports

const SECRET_KEY = /(secret|token|password|passwd|api[_-]?key|private[_-]?key|credential|authorization|webhook[_-]?secret|connection[_-]?string)/i;

/** A value that is safe to store in a history row or export: secret-looking keys and secret-shaped text are masked, long text is cut. */
export function safeConfigValue(key: string, value: unknown, depthLeft = 4): unknown {
  if (SECRET_KEY.test(key) && !key.toLowerCase().endsWith("_ref") && !key.toLowerCase().endsWith("reference")) return "[hidden]";
  if (typeof value === "string") return looksLikeSecret(value) ? "[hidden]" : redactString(value, 300);
  if (value === null || typeof value !== "object") return value;
  if (depthLeft <= 0) return "[nested]";
  if (Array.isArray(value)) return value.slice(0, 50).map((x) => safeConfigValue(key, x, depthLeft - 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 50).map(([k, v]) => [k, safeConfigValue(k, v, depthLeft - 1)]));
}

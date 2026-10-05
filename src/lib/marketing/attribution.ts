import { createHmac } from "crypto";

// STEP 29 §18 — UTM / click-id handling. Values are charset-validated and length-capped (they are echoed into
// the database and admin screens). Raw click ids (fbclid/gclid/ttclid) are never stored — only a salted hash.

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export const CLICK_ID_KEYS = ["fbclid", "gclid", "ttclid"] as const;
export type ClickIdType = (typeof CLICK_ID_KEYS)[number];

const UTM_VALUE_RE = /^[A-Za-z0-9_.\-~ ]{1,100}$/;

export function sanitizeUtm(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  return UTM_VALUE_RE.test(v) ? v : undefined;
}

export interface UtmSet {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
}

export function extractUtm(params: { get(name: string): string | null }): UtmSet {
  return {
    source: sanitizeUtm(params.get("utm_source")),
    medium: sanitizeUtm(params.get("utm_medium")),
    campaign: sanitizeUtm(params.get("utm_campaign")),
    content: sanitizeUtm(params.get("utm_content")),
    term: sanitizeUtm(params.get("utm_term")),
  };
}

function clickSalt(): string {
  return process.env.RISK_HASH_SALT ?? process.env.NEXTAUTH_SECRET ?? "lpp-dev-marketing-click-salt";
}

export function hashClickId(type: ClickIdType, value: string): string {
  return createHmac("sha256", clickSalt()).update(`${type}:${value}`).digest("hex").slice(0, 40);
}

export function extractClickId(params: { get(name: string): string | null }): { type: ClickIdType; hash: string } | null {
  for (const key of CLICK_ID_KEYS) {
    const v = params.get(key);
    if (v && v.length <= 512 && /^[A-Za-z0-9_\-.]+$/.test(v)) return { type: key, hash: hashClickId(key, v) };
  }
  return null;
}

// Only the host of a referrer is kept (never a path/query, which can carry personal data).
export function referrerHostOf(referrer: string | null | undefined): string | undefined {
  if (!referrer) return undefined;
  try {
    const h = new URL(referrer).hostname.toLowerCase();
    return h.length <= 120 ? h : undefined;
  } catch {
    return undefined;
  }
}

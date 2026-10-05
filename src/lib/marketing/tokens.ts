import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "crypto";

// STEP 29 §14/§18 — server-signed tokens for the PUBLIC surface (no cookies, no persistent identifiers).
//  • Form token: proves a form was rendered for a specific form VERSION and gives each submission a unique nonce
//    (idempotency), a minimum-time-to-submit check and an expiry. Minted client-side from a rate-limited GET so cached
//    landing HTML never embeds a stale token.
//  • Touch token: minted when a landing page is rendered; carries the sanitised attribution the SERVER observed
//    (campaign, page version, UTMs, click-id hash). The submit route trusts only a valid touch token — a client that
//    edits its own UTMs gets UNVERIFIED attribution, never a forged campaign.

const SEP = ".";

function secret(): Buffer {
  const base = process.env.MARKETING_TOKEN_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!base) throw new Error("NEXTAUTH_SECRET (or MARKETING_TOKEN_SECRET) is not set");
  return Buffer.from(hkdfSync("sha256", base, "lpp-marketing-public-token", "marketing", 32));
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const FORM_TOKEN_MIN_AGE_MS = 3_000;
export const FORM_TOKEN_MAX_AGE_MS = 2 * 60 * 60 * 1000;
export const TOUCH_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface FormTokenClaims {
  formId: string;
  formVersionId: string;
  nonce: string;
  issuedAt: number;
}

export function issueFormToken(params: { formId: string; formVersionId: string; now?: number }): string {
  const now = params.now ?? Date.now();
  const nonce = randomBytes(12).toString("base64url");
  const payload = ["f", params.formId, params.formVersionId, nonce, String(now)].join(SEP);
  return `${payload}${SEP}${sign(payload)}`;
}

export type TokenFailure = "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" | "TOO_FAST" | "MISMATCH";

export function verifyFormToken(
  token: string,
  expected: { formId: string; formVersionId?: string },
  now = Date.now(),
): { valid: true; claims: FormTokenClaims } | { valid: false; reason: TokenFailure } {
  const parts = token.split(SEP);
  if (parts.length !== 6 || parts[0] !== "f") return { valid: false, reason: "MALFORMED" };
  const [, formId, formVersionId, nonce, issuedRaw, signature] = parts;
  const payload = parts.slice(0, 5).join(SEP);
  if (!safeEqual(signature, sign(payload))) return { valid: false, reason: "BAD_SIGNATURE" };
  const issuedAt = Number(issuedRaw);
  if (!Number.isFinite(issuedAt)) return { valid: false, reason: "MALFORMED" };
  if (formId !== expected.formId || (expected.formVersionId && formVersionId !== expected.formVersionId)) return { valid: false, reason: "MISMATCH" };
  if (now - issuedAt > FORM_TOKEN_MAX_AGE_MS) return { valid: false, reason: "EXPIRED" };
  if (now - issuedAt < FORM_TOKEN_MIN_AGE_MS) return { valid: false, reason: "TOO_FAST" };
  return { valid: true, claims: { formId, formVersionId, nonce, issuedAt } };
}

export interface TouchClaims {
  campaignId: string | null;
  pageId: string | null;
  pageVersionId: string | null;
  utm: { source?: string; medium?: string; campaign?: string; content?: string; term?: string };
  clickIdType?: string;
  clickIdHash?: string;
  referrerHost?: string;
  // A/B experiment bucket the SERVER assigned at render (so the submit route records the right variant).
  experimentId?: string;
  variantKey?: string;
  issuedAt: number;
}

export function issueTouchToken(claims: Omit<TouchClaims, "issuedAt"> & { issuedAt?: number }): string {
  const full: TouchClaims = { ...claims, issuedAt: claims.issuedAt ?? Date.now() };
  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `t${SEP}${body}${SEP}${sign(`t${SEP}${body}`)}`;
}

export function verifyTouchToken(token: string | null | undefined, now = Date.now()): { valid: true; claims: TouchClaims } | { valid: false; reason: TokenFailure } {
  if (!token) return { valid: false, reason: "MALFORMED" };
  const parts = token.split(SEP);
  if (parts.length !== 3 || parts[0] !== "t") return { valid: false, reason: "MALFORMED" };
  const [, body, signature] = parts;
  if (!safeEqual(signature, sign(`t${SEP}${body}`))) return { valid: false, reason: "BAD_SIGNATURE" };
  let claims: TouchClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TouchClaims;
  } catch {
    return { valid: false, reason: "MALFORMED" };
  }
  if (typeof claims.issuedAt !== "number" || now - claims.issuedAt > TOUCH_TOKEN_MAX_AGE_MS) return { valid: false, reason: "EXPIRED" };
  return { valid: true, claims };
}

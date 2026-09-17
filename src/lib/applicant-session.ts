import { createHmac, timingSafeEqual } from "crypto";

// A lightweight replacement for full applicant accounts (no passwords, no
// OTP, no session table): a signed cookie that proves "this browser
// submitted profile X" without ever exposing a guessable/enumerable URL.
// Changing a URL/ID can't expose someone else's profile because there is no
// URL parameter at all — only an HMAC only the server can produce or verify.
export const APPLICANT_COOKIE = "lpp_session";

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set");
  return s;
}

export function signProfileToken(profileId: string): string {
  const sig = createHmac("sha256", secret()).update(profileId).digest("base64url");
  return `${profileId}.${sig}`;
}

export function verifyProfileToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const profileId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret()).update(profileId).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return profileId;
}

// STEP 13 — a second, separately-signed cookie carrying a revocable
// ProfileSession id, kept as its own cookie (not merged into the token
// above) so every route that already calls verifyProfileToken() keeps
// working unchanged; only requireApplicantProfileId() additionally checks
// this one, making "Log Out Other Sessions" real for routes that use it.
// A browser with no session cookie yet (pre-STEP-13) is grandfathered
// through session-less rather than logged out — the next /api/my-status
// login provisions one.
export const APPLICANT_SESSION_ID_COOKIE = "lpp_sid";

export function signSessionId(sessionId: string): string {
  const sig = createHmac("sha256", secret()).update(sessionId).digest("base64url");
  return `${sessionId}.${sig}`;
}

export function verifySessionIdToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const sessionId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret()).update(sessionId).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return sessionId;
}

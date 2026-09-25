import { createHmac, timingSafeEqual } from "crypto";

// STEP 22 — a signed cookie carrying a revocable FamilyMemberSession id.
// Unlike the applicant's lpp_session/lpp_sid pair (two cookies, for historical
// reasons — the session-id cookie was added in STEP 13 on top of an
// already-shipped passwordless token, and kept separate so existing routes
// wouldn't need to change), family members are new from the start and are
// password-authenticated (Decision 2) — the session row itself IS the
// credential after login, so ONE signed cookie is sufficient here. Same HMAC
// crypto as src/lib/applicant-session.ts, not a new scheme.
export const FAMILY_SESSION_ID_COOKIE = "lpp_fam_sid";

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set");
  return s;
}

export function signFamilySessionId(sessionId: string): string {
  const sig = createHmac("sha256", secret()).update(sessionId).digest("base64url");
  return `${sessionId}.${sig}`;
}

export function verifyFamilySessionIdToken(token: string | undefined | null): string | null {
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

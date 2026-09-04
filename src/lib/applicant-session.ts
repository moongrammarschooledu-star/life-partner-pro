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

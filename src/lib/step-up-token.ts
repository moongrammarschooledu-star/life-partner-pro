import crypto from "crypto";

// Short-lived, signed proof tokens for two distinct "step-up" moments:
//   - a 2FA challenge was just verified (src/app/api/admin/auth/verify-otp)
//   - the current admin just re-entered their password (src/app/api/admin/auth/reauth)
// Both are HMAC-signed strings, not DB rows — cheap to verify, impossible to
// forge without NEXTAUTH_SECRET, and naturally expire without cleanup.

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not configured");
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}

export function issueStepUpToken(purpose: string, subject: string, ttlMs: number): string {
  const expiresAt = Date.now() + ttlMs;
  const payload = `${purpose}:${subject}:${expiresAt}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

export function verifyStepUpToken(token: string | null | undefined, purpose: string, subject: string): boolean {
  if (!token) return false;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return false;
  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return false;
  }
  if (sign(payload) !== signature) return false;

  const [tokenPurpose, tokenSubject, expiresAtStr] = payload.split(":");
  if (tokenPurpose !== purpose || tokenSubject !== subject) return false;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
  return true;
}

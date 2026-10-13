import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "crypto";

// Push tokens are protected at rest with AES-256-GCM (STEP 37 §11). The key is derived (HKDF, its own domain string) from MOBILE_ENCRYPTION_KEY when set,
// else from NEXTAUTH_SECRET, and is never in source code. Token format: v1.<iv>.<authTag>.<ciphertext> (base64url). A token is decrypted only inside the
// push sender; no API ever returns it.

function key(): Buffer {
  const secret = process.env.MOBILE_ENCRYPTION_KEY?.trim() || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("MOBILE_ENCRYPTION_KEY or NEXTAUTH_SECRET must be set");
  return Buffer.from(hkdfSync("sha256", secret, "lpp-mobile-push-token", "push-token", 32));
}

export function encryptPushToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptPushToken(value: string): string | null {
  try {
    const parts = value.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(parts[1], "base64url"));
    d.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([d.update(Buffer.from(parts[3], "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** A one-way fingerprint used to find a token that moved to another account or was reported invalid, without decrypting anything. */
export function hashPushToken(token: string): string {
  return createHash("sha256").update(`lpp-push:${token}`).digest("hex");
}
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

// Message content is protected at rest with AES-256-GCM. The key is never in source code: it is derived (HKDF, its own
// domain string, so it is cryptographically separated from document / evidence / photo keys) from
// COMMUNICATION_ENCRYPTION_KEY when set, else from NEXTAUTH_SECRET (the same root secret the other at-rest features use).
// Token format:  v1.<iv>.<authTag>.<ciphertext>  (all base64url) - self-describing so the key can be rotated later.

function communicationKey(): Buffer {
  const secret = process.env.COMMUNICATION_ENCRYPTION_KEY?.trim() || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("COMMUNICATION_ENCRYPTION_KEY or NEXTAUTH_SECRET must be set");
  return Buffer.from(hkdfSync("sha256", secret, "lpp-communication-encryption", "communication-content", 32));
}

export function encryptText(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", communicationKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function isEncryptedToken(value: string | null | undefined): boolean {
  return typeof value === "string" && /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(value);
}

// Throws on a tampered or foreign token (GCM authentication) - callers treat that as "content unavailable".
export function decryptText(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Unsupported encrypted content");
  const decipher = createDecipheriv("aes-256-gcm", communicationKey(), Buffer.from(parts[1], "base64url"));
  decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
}

// Read a stored body that may or may not be encrypted (rows written before STEP 25 are plaintext). Never throws.
export function readStoredBody(body: string | null, encrypted: boolean): string | null {
  if (body === null) return null;
  if (!encrypted) return body;
  try {
    return decryptText(body);
  } catch {
    return null;
  }
}

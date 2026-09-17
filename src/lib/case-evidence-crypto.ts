import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

// Same AES-256-GCM approach as src/lib/verification/document-crypto.ts, kept
// as its own tiny file (not a shared/parameterized function) so the proven
// verification-document path is never touched — a distinct HKDF info string
// ("case-evidence") gives cryptographic domain separation from verification
// documents even though both derive from the same NEXTAUTH_SECRET.

function evidenceKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return Buffer.from(hkdfSync("sha256", secret, "lpp-document-encryption", "case-evidence", 32));
}

export interface EncryptedPayload {
  ciphertext: Buffer;
  ivBase64: string;
  authTagBase64: string;
}

export function encryptEvidence(plaintext: Buffer): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", evidenceKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, ivBase64: iv.toString("base64"), authTagBase64: cipher.getAuthTag().toString("base64") };
}

export function decryptEvidence(ciphertext: Buffer, ivBase64: string, authTagBase64: string): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", evidenceKey(), Buffer.from(ivBase64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

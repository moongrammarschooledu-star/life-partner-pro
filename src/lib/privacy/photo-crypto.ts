import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

// Same AES-256-GCM approach as case-evidence-crypto.ts/document-crypto.ts,
// kept as its own tiny file for the same reason those are separate — a
// distinct HKDF info string ("profile-photo") gives cryptographic domain
// separation even though all three derive from the same NEXTAUTH_SECRET.

function photoKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return Buffer.from(hkdfSync("sha256", secret, "lpp-document-encryption", "profile-photo", 32));
}

export interface EncryptedPhoto {
  ciphertext: Buffer;
  ivBase64: string;
  authTagBase64: string;
}

export function encryptPhoto(plaintext: Buffer): EncryptedPhoto {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", photoKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, ivBase64: iv.toString("base64"), authTagBase64: cipher.getAuthTag().toString("base64") };
}

export function decryptPhoto(ciphertext: Buffer, ivBase64: string, authTagBase64: string): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", photoKey(), Buffer.from(ivBase64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

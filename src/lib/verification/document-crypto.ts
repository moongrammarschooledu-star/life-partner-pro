import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

// Application-layer AES-256-GCM for uploaded verification documents (spec
// §7/§24 "encrypted where supported"). Vercel Blob has no customer-managed
// encryption option on this project's plan, so this substitutes at the
// application layer rather than claiming real KMS/HSM protection — the key
// is derived via HKDF from NEXTAUTH_SECRET (already required to exist, see
// src/lib/applicant-session.ts) plus a fixed context string, so no new env
// var needs provisioning in Vercel.

function documentKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return Buffer.from(hkdfSync("sha256", secret, "lpp-document-encryption", "verification-documents", 32));
}

export interface EncryptedPayload {
  ciphertext: Buffer;
  ivBase64: string;
  authTagBase64: string;
}

export function encryptDocument(plaintext: Buffer): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", documentKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, ivBase64: iv.toString("base64"), authTagBase64: cipher.getAuthTag().toString("base64") };
}

export function decryptDocument(ciphertext: Buffer, ivBase64: string, authTagBase64: string): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", documentKey(), Buffer.from(ivBase64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

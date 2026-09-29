import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

// Application-layer AES-256-GCM for the general Document store — identical pattern to
// src/lib/verification/document-crypto.ts (no real KMS/HSM on this plan; the key is derived via HKDF
// from NEXTAUTH_SECRET, already required to exist), kept as its own module (its own HKDF context
// string) rather than importing the verification one, so the two stores can never share ciphertext by accident.

function documentKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return Buffer.from(hkdfSync("sha256", secret, "lpp-document-management-encryption", "documents", 32));
}

export interface EncryptedPayload {
  ciphertext: Buffer;
  ivBase64: string;
  authTagBase64: string;
}

export function encryptDocumentBytes(plaintext: Buffer): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", documentKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, ivBase64: iv.toString("base64"), authTagBase64: cipher.getAuthTag().toString("base64") };
}

export function decryptDocumentBytes(ciphertext: Buffer, ivBase64: string, authTagBase64: string): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", documentKey(), Buffer.from(ivBase64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

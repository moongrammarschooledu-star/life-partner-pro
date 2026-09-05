import { describe, it, expect, beforeAll } from "vitest";
import { encryptDocument, decryptDocument } from "./document-crypto";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET ??= "test-secret-for-vitest-only";
});

describe("document-crypto roundtrip", () => {
  it("decrypts back to the original plaintext", () => {
    const plaintext = Buffer.from("this is a fake identity document, not a real secret");
    const { ciphertext, ivBase64, authTagBase64 } = encryptDocument(plaintext);
    const decrypted = decryptDocument(ciphertext, ivBase64, authTagBase64);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it("produces different ciphertext for the same plaintext each time (random IV)", () => {
    const plaintext = Buffer.from("same content");
    const a = encryptDocument(plaintext);
    const b = encryptDocument(plaintext);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.ivBase64).not.toBe(b.ivBase64);
  });

  it("fails to decrypt with a tampered auth tag", () => {
    const plaintext = Buffer.from("tamper test");
    const { ciphertext, ivBase64, authTagBase64 } = encryptDocument(plaintext);
    const tamperedTag = Buffer.from(authTagBase64, "base64");
    tamperedTag[0] ^= 0xff;
    expect(() => decryptDocument(ciphertext, ivBase64, tamperedTag.toString("base64"))).toThrow();
  });
});

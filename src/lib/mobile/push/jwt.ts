import { createPrivateKey, createSign, sign as cryptoSign, type KeyObject } from "crypto";

// Minimal JWT signing for the two push services (no third-party SDK, so nothing extra ships to the server and no credential is handed to a library).

const b64 = (v: object | Buffer) => (Buffer.isBuffer(v) ? v : Buffer.from(JSON.stringify(v))).toString("base64url");

/** RS256 — Google service-account assertion. `privateKey` is a PEM string. */
export function signRs256(header: object, claims: object, privateKey: string | KeyObject): string {
  const input = `${b64(header)}.${b64(claims)}`;
  const sig = createSign("RSA-SHA256").update(input).sign(privateKey);
  return `${input}.${b64(sig)}`;
}

/** ES256 — Apple provider token. The signature must be the raw r||s form (IEEE P1363), not DER. */
export function signEs256(header: object, claims: object, privateKey: string | KeyObject): string {
  const input = `${b64(header)}.${b64(claims)}`;
  const key = typeof privateKey === "string" ? createPrivateKey(privateKey) : privateKey;
  const sig = cryptoSign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return `${input}.${b64(sig)}`;
}

/** Environment variables hold multi-line keys with literal \n; this restores real line breaks. */
export function normalisePem(raw: string): string {
  return raw.replace(/\\n/g, "\n").trim();
}
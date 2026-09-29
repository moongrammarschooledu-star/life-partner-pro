import { createHmac, hkdfSync, timingSafeEqual } from "crypto";

// Signed, short-lived, single-scope access tickets (spec §8 "signed temporary URL"). Vercel Blob has no
// presigned-URL capability actually in use anywhere in this codebase — photos/verification-documents/
// case-evidence are all already streamed back server-side rather than exposed as a raw URL — so this is
// the honest, working equivalent: an HMAC-signed token naming exactly one document, one viewer, one
// action and one expiry, verified server-side on every preview/download request. Never reusable after
// expiry or for a different document/viewer/scope than it was issued for.

export type DocumentAccessScope = "PREVIEW" | "DOWNLOAD";

export interface DocumentAccessTokenParams {
  documentId: string;
  viewerType: string;
  viewerId: string;
  scope: DocumentAccessScope;
  ttlSeconds?: number;
}

function tokenSecret(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return Buffer.from(hkdfSync("sha256", secret, "lpp-document-access-token", "documents", 32));
}

function sign(payload: string): string {
  return createHmac("sha256", tokenSecret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const DEFAULT_TTL_SECONDS = 90;
const SEP = "."; // safe: cuid/id/enum-style fields never contain a literal "."

export function createDocumentAccessToken(params: DocumentAccessTokenParams): string {
  const expiresAt = Math.floor(Date.now() / 1000) + (params.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  const payload = [params.documentId, params.viewerType, params.viewerId, params.scope, String(expiresAt)].join(SEP);
  return `${payload}${SEP}${sign(payload)}`;
}

export interface VerifyResult {
  valid: boolean;
  reason?: "MALFORMED" | "EXPIRED" | "MISMATCH" | "BAD_SIGNATURE";
}

// The caller supplies what it independently knows to be true right now (the document being requested,
// the authenticated viewer, the action) — the token must match ALL of it, not just carry a valid signature.
export function verifyDocumentAccessToken(token: string, expected: Omit<DocumentAccessTokenParams, "ttlSeconds">): VerifyResult {
  const parts = token.split(SEP);
  if (parts.length !== 6) return { valid: false, reason: "MALFORMED" };
  const [documentId, viewerType, viewerId, scope, expiresAtRaw, signature] = parts;
  const payload = [documentId, viewerType, viewerId, scope, expiresAtRaw].join(SEP);
  if (!safeEqual(signature, sign(payload))) return { valid: false, reason: "BAD_SIGNATURE" };
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || Math.floor(Date.now() / 1000) > expiresAt) return { valid: false, reason: "EXPIRED" };
  if (documentId !== expected.documentId || viewerType !== expected.viewerType || viewerId !== expected.viewerId || scope !== expected.scope) {
    return { valid: false, reason: "MISMATCH" };
  }
  return { valid: true };
}

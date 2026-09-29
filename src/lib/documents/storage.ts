import { put, del } from "@vercel/blob";
import { createHash, randomUUID } from "crypto";
import { validateUpload, safeFilename, type DetectedType } from "@/lib/ops/upload-validation";
import { imageDimensionsOk } from "@/lib/ops/image-check";
import { encryptDocumentBytes, decryptDocumentBytes } from "@/lib/documents/crypto";

// Storage for the general Document store — mirrors src/lib/verification/document-storage.ts exactly:
// Vercel Blob + application-layer AES-256-GCM, the raw blob key/URL is never sent to the client, bytes
// are only ever read back server-side (see access-tokens.ts + the streaming API routes). A SHA-256 hash
// of the PLAINTEXT bytes is also returned, used for tamper detection and duplicate-file detection.

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024; // 15MB — configurable in code like the other *-storage.ts modules
export const ALLOWED_DOCUMENT_TYPES: readonly DetectedType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

export class DocumentUploadError extends Error {}

export interface SavedDocument {
  secureStorageReference: string;
  ivBase64: string;
  authTagBase64: string;
  mimeType: string;
  sizeBytes: number;
  fileHash: string;
  originalFilename: string;
}

export function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Validation only — no storage side effect. Split out so the security scanner can run on the
// plaintext bytes BEFORE anything is written to blob storage.
export async function validateDocumentUpload(file: Buffer, mimeType: string, filename?: string | null): Promise<{ detected: DetectedType }> {
  if (file.byteLength === 0) throw new DocumentUploadError("The file is empty.");
  const check = validateUpload({ buffer: file, declaredMime: mimeType, filename, allowed: ALLOWED_DOCUMENT_TYPES, maxBytes: MAX_DOCUMENT_BYTES });
  if (!check.ok) throw new DocumentUploadError(check.error);
  if (check.detected.startsWith("image/") && !(await imageDimensionsOk(file))) throw new DocumentUploadError("Image dimensions are too large.");
  return { detected: check.detected };
}

export async function saveDocumentBytes(file: Buffer, mimeType: string, filename?: string | null): Promise<SavedDocument> {
  const { detected } = await validateDocumentUpload(file, mimeType, filename);
  const fileHash = hashBytes(file);
  const { ciphertext, ivBase64, authTagBase64 } = encryptDocumentBytes(file);
  const blob = await put(`documents/${randomUUID()}.enc`, ciphertext, { access: "public", contentType: "application/octet-stream", addRandomSuffix: true });
  return { secureStorageReference: blob.url, ivBase64, authTagBase64, mimeType: detected, sizeBytes: file.byteLength, fileHash, originalFilename: safeFilename(filename) };
}

export async function readDocumentBytes(secureStorageReference: string, ivBase64: string, authTagBase64: string): Promise<Buffer> {
  const res = await fetch(secureStorageReference);
  if (!res.ok) throw new Error(`Failed to fetch document from blob storage: ${res.status}`);
  const ciphertext = Buffer.from(await res.arrayBuffer());
  return decryptDocumentBytes(ciphertext, ivBase64, authTagBase64);
}

export async function deleteDocumentBytes(secureStorageReference: string): Promise<void> {
  await del(secureStorageReference).catch(() => undefined);
}

// Tamper detection (spec §44/§45): re-hash the plaintext and compare to what was stored at upload time.
export function verifyIntegrity(bytes: Buffer, expectedHash: string): boolean {
  return hashBytes(bytes) === expectedHash;
}

import { put, del } from "@vercel/blob";
import { randomUUID } from "crypto";
import { encryptDocument, decryptDocument } from "@/lib/verification/document-crypto";

// Mirrors src/lib/storage.ts's photo pattern (Vercel Blob, raw URL never
// sent to the client, only ever read server-side through an authenticated
// route) but adds application-layer AES-256-GCM over the bytes — see
// document-crypto.ts for why (no real KMS available on this plan).
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export class DocumentUploadError extends Error {}

export async function saveVerificationDocument(
  file: Buffer,
  mimeType: string
): Promise<{ secureStorageReference: string; ivBase64: string; authTagBase64: string; mimeType: string; sizeBytes: number }> {
  if (!ALLOWED_MIME.has(mimeType)) {
    throw new DocumentUploadError("Unsupported file type. Use JPEG, PNG, WebP, or PDF.");
  }
  if (file.byteLength > MAX_UPLOAD_BYTES) {
    throw new DocumentUploadError("File is too large (max 10MB).");
  }

  const { ciphertext, ivBase64, authTagBase64 } = encryptDocument(file);
  const blob = await put(`verification-documents/${randomUUID()}.enc`, ciphertext, {
    access: "public",
    contentType: "application/octet-stream",
    addRandomSuffix: true,
  });

  return { secureStorageReference: blob.url, ivBase64, authTagBase64, mimeType, sizeBytes: file.byteLength };
}

export async function readVerificationDocument(secureStorageReference: string, ivBase64: string, authTagBase64: string): Promise<Buffer> {
  const res = await fetch(secureStorageReference);
  if (!res.ok) throw new Error(`Failed to fetch document from blob storage: ${res.status}`);
  const ciphertext = Buffer.from(await res.arrayBuffer());
  return decryptDocument(ciphertext, ivBase64, authTagBase64);
}

export async function deleteVerificationDocument(secureStorageReference: string): Promise<void> {
  await del(secureStorageReference).catch(() => undefined);
}

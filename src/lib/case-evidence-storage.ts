import { put, del } from "@vercel/blob";
import { randomUUID } from "crypto";
import { validateUpload } from "@/lib/ops/upload-validation";
import { imageDimensionsOk } from "@/lib/ops/image-check";
import { encryptEvidence, decryptEvidence } from "@/lib/case-evidence-crypto";

// Mirrors src/lib/verification/document-storage.ts exactly (spec §12) —
// Vercel Blob, application-layer AES-256-GCM, raw URL never sent to the
// client, only ever read server-side through an authenticated streaming
// route (see src/app/api/admin/case-evidence/[id]/route.ts).
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export class EvidenceUploadError extends Error {}

export async function saveCaseEvidence(
  file: Buffer,
  mimeType: string
): Promise<{ secureStorageReference: string; ivBase64: string; authTagBase64: string; mimeType: string; sizeBytes: number }> {
  if (!ALLOWED_MIME.has(mimeType)) {
    throw new EvidenceUploadError("Unsupported file type. Use JPEG, PNG, WebP, or PDF.");
  }
  if (file.byteLength > MAX_UPLOAD_BYTES) {
    throw new EvidenceUploadError("File is too large (max 10MB).");
  }

  // STEP 15 §33 — real file type from magic bytes (declared MIME is not trusted);
  // images additionally get a pixel-dimension cap.
  const check = validateUpload({ buffer: file, declaredMime: mimeType, allowed: ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const, maxBytes: MAX_UPLOAD_BYTES });
  if (!check.ok) throw new EvidenceUploadError(check.error);
  if (check.detected !== "application/pdf" && !(await imageDimensionsOk(file))) throw new EvidenceUploadError("Image dimensions are too large.");

  const { ciphertext, ivBase64, authTagBase64 } = encryptEvidence(file);
  const blob = await put(`case-evidence/${randomUUID()}.enc`, ciphertext, {
    access: "public",
    contentType: "application/octet-stream",
    addRandomSuffix: true,
  });

  return { secureStorageReference: blob.url, ivBase64, authTagBase64, mimeType, sizeBytes: file.byteLength };
}

export async function readCaseEvidence(secureStorageReference: string, ivBase64: string, authTagBase64: string): Promise<Buffer> {
  const res = await fetch(secureStorageReference);
  if (!res.ok) throw new Error(`Failed to fetch evidence from blob storage: ${res.status}`);
  const ciphertext = Buffer.from(await res.arrayBuffer());
  return decryptEvidence(ciphertext, ivBase64, authTagBase64);
}

export async function deleteCaseEvidence(secureStorageReference: string): Promise<void> {
  await del(secureStorageReference).catch(() => undefined);
}

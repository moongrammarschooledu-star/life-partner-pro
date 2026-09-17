import { put, del } from "@vercel/blob";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { encryptPhoto, decryptPhoto } from "@/lib/privacy/photo-crypto";

// Vercel's serverless functions have no persistent writable disk, so photos
// live in Vercel Blob rather than on disk. Blob URLs are unlisted but not
// authenticated by Vercel itself — the actual access control is that the
// raw blob URL (storageKey) is never sent to the browser. Every read goes
// through an authenticated route (see
// app/api/admin/profiles/[id]/photo/[photoId]/route.ts and the self-service
// app/api/my-profile/photo/[photoId]/route.ts, STEP 13), which fetches the
// blob server-side and streams the bytes back; the client never sees this
// URL directly.
//
// STEP 13 — photos are now AES-256-GCM encrypted at rest (see
// src/lib/privacy/photo-crypto.ts), mirroring the verification-document/
// case-evidence pattern. The sharp re-encode (EXIF/GPS strip + resize)
// still happens on plaintext bytes first, unchanged; only the final JPEG
// bytes are encrypted before upload. ivBase64/authTagBase64 are nullable on
// ProfilePhoto so photos uploaded before this step keep working via the
// raw-fetch fallback in readPhoto() below, rather than a forced migration.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB raw upload cap
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export class UploadValidationError extends Error {}

export async function savePhoto(
  file: Buffer,
  mimeType: string
): Promise<{ storageKey: string; mimeType: string; sizeBytes: number; ivBase64: string; authTagBase64: string }> {
  if (!ALLOWED_MIME.has(mimeType)) {
    throw new UploadValidationError("Unsupported image type. Use JPEG, PNG, or WebP.");
  }
  if (file.byteLength > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError("Image is too large (max 8MB).");
  }

  // Re-encode to strip metadata (incl. EXIF/GPS) and normalize size — also
  // acts as a sanity check that the bytes are actually a decodable image.
  const processed = await sharp(file)
    .rotate()
    .resize(800, 800, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  const { ciphertext, ivBase64, authTagBase64 } = encryptPhoto(processed);

  const blob = await put(`photos/${randomUUID()}.enc`, ciphertext, {
    access: "public",
    contentType: "application/octet-stream",
    addRandomSuffix: true,
  });

  return { storageKey: blob.url, mimeType: "image/jpeg", sizeBytes: processed.byteLength, ivBase64, authTagBase64 };
}

export async function readPhoto(storageKey: string, ivBase64?: string | null, authTagBase64?: string | null): Promise<Buffer> {
  const res = await fetch(storageKey);
  if (!res.ok) throw new Error(`Failed to fetch photo from blob storage: ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!ivBase64 || !authTagBase64) return bytes; // pre-STEP-13 unencrypted photo
  return decryptPhoto(bytes, ivBase64, authTagBase64);
}

export async function deletePhoto(storageKey: string): Promise<void> {
  await del(storageKey).catch(() => undefined);
}

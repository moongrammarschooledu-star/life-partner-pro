import { put, del } from "@vercel/blob";
import { randomUUID } from "crypto";
import sharp from "sharp";

// Vercel's serverless functions have no persistent writable disk, so photos
// live in Vercel Blob rather than on disk. Blob URLs are unlisted but not
// authenticated by Vercel itself — the actual access control is that the
// raw blob URL (storageKey) is never sent to the browser. Every read goes
// through the authenticated admin route (see
// app/api/admin/profiles/[id]/photo/[photoId]/route.ts), which fetches the
// blob server-side and streams the bytes back; the client never sees this
// URL directly.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB raw upload cap
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export class UploadValidationError extends Error {}

export async function savePhoto(file: Buffer, mimeType: string): Promise<{ storageKey: string; mimeType: string; sizeBytes: number }> {
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

  const blob = await put(`photos/${randomUUID()}.jpg`, processed, {
    access: "public",
    contentType: "image/jpeg",
    addRandomSuffix: true,
  });

  return { storageKey: blob.url, mimeType: "image/jpeg", sizeBytes: processed.byteLength };
}

export async function readPhoto(storageKey: string): Promise<Buffer> {
  const res = await fetch(storageKey);
  if (!res.ok) throw new Error(`Failed to fetch photo from blob storage: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function deletePhoto(storageKey: string): Promise<void> {
  await del(storageKey).catch(() => undefined);
}

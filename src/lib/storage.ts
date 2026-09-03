import { mkdir, writeFile, readFile, unlink } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";

// Photos live outside `public/` so they are never statically servable —
// every read goes through an authenticated API route (see
// app/api/profiles/[id]/photo/route.ts) that checks the admin session first.
const UPLOAD_ROOT = path.join(process.cwd(), "private-uploads", "photos");

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

  await mkdir(UPLOAD_ROOT, { recursive: true });

  // Re-encode to strip metadata (incl. EXIF/GPS) and normalize size — also
  // acts as a sanity check that the bytes are actually a decodable image.
  const processed = await sharp(file)
    .rotate()
    .resize(800, 800, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  const storageKey = `${randomUUID()}.jpg`;
  await writeFile(path.join(UPLOAD_ROOT, storageKey), processed);

  return { storageKey, mimeType: "image/jpeg", sizeBytes: processed.byteLength };
}

export async function readPhoto(storageKey: string): Promise<Buffer> {
  const safeName = path.basename(storageKey); // defense in depth against path traversal
  return readFile(path.join(UPLOAD_ROOT, safeName));
}

export async function deletePhoto(storageKey: string): Promise<void> {
  const safeName = path.basename(storageKey);
  await unlink(path.join(UPLOAD_ROOT, safeName)).catch(() => undefined);
}

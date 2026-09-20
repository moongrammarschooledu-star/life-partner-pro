import sharp from "sharp";
import { MAX_IMAGE_PIXELS } from "@/lib/ops/upload-validation";

// Decodes just the image header (no full decode) and enforces a per-side pixel
// cap — blocks decompression-bomb style images (spec §33 "image dimensions").
export async function imageDimensionsOk(buffer: Buffer): Promise<boolean> {
  try {
    const meta = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS * MAX_IMAGE_PIXELS }).metadata();
    return Boolean(meta.width && meta.height && meta.width <= MAX_IMAGE_PIXELS && meta.height <= MAX_IMAGE_PIXELS);
  } catch {
    return false;
  }
}

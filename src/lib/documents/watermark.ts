import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import sharp from "sharp";

// Real watermarking for previews/downloads of sensitive documents (spec §30) — pdf-lib and sharp are
// already dependencies (invoice PDFs / photo processing). The ORIGINAL bytes are never touched: a
// watermarked copy is produced in memory and returned to the caller, never written back to storage.

export interface WatermarkInfo {
  documentCode: string;
  viewerLabel: string; // e.g. "Authorized User" or a masked identifier — never a full name/contact detail
  viewedAt: Date;
}

function watermarkLines(info: WatermarkInfo): string[] {
  return ["CONFIDENTIAL — Life Partner Pro", `Viewed by: ${info.viewerLabel}`, info.viewedAt.toISOString(), `Document: ${info.documentCode}`];
}

export async function watermarkPdf(bytes: Buffer, info: WatermarkInfo): Promise<Buffer> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const text = watermarkLines(info).join("   •   ");
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    // A single diagonal, semi-transparent line of text across the page — visible but never obscures content entirely.
    page.drawText(text, { x: width * 0.08, y: height * 0.5, size: 9, font, color: rgb(0.55, 0.1, 0.1), opacity: 0.45, rotate: degrees(30) });
    page.drawText(text, { x: 20, y: 14, size: 7, font, color: rgb(0.3, 0.3, 0.3), opacity: 0.8 });
  }
  return Buffer.from(await doc.save());
}

export async function watermarkImage(bytes: Buffer, info: WatermarkInfo): Promise<Buffer> {
  const image = sharp(bytes);
  const meta = await image.metadata();
  const width = meta.width ?? 800;
  const lines = watermarkLines(info);
  const fontSize = Math.max(12, Math.round(width / 40));
  const svg = `<svg width="${width}" height="${meta.height ?? 600}" xmlns="http://www.w3.org/2000/svg">
    <style>text{font-family:sans-serif;font-size:${fontSize}px;fill:rgba(180,20,20,0.55);}</style>
    <text x="4%" y="50%" transform="rotate(-20 ${width / 2} ${(meta.height ?? 600) / 2})">${lines[0]}</text>
    <text x="2%" y="97%" font-size="${Math.max(10, fontSize * 0.6)}" fill="rgba(60,60,60,0.85)">${lines.slice(1).join("  |  ")}</text>
  </svg>`;
  return image.composite([{ input: Buffer.from(svg), gravity: "center" }]).toBuffer();
}

// Dispatches by mime type; documents this can't watermark (docx/xlsx) are returned unchanged with a
// caller-visible flag — the access log still records that a watermark was requested, never silently drops it.
export async function watermarkBytes(bytes: Buffer, mimeType: string, info: WatermarkInfo): Promise<{ bytes: Buffer; watermarked: boolean }> {
  try {
    if (mimeType === "application/pdf") return { bytes: await watermarkPdf(bytes, info), watermarked: true };
    if (mimeType.startsWith("image/")) return { bytes: await watermarkImage(bytes, info), watermarked: true };
  } catch {
    // never fail the whole request over a watermarking problem — fall through to unwatermarked delivery
  }
  return { bytes, watermarked: false };
}

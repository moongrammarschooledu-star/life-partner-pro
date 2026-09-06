import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ColumnDef } from "@/lib/reports/columns";

// pdf-lib chosen over pdfkit specifically because it embeds standard fonts
// directly (no fs.readFileSync of package-relative font files), avoiding a
// known pdfkit-under-Next.js-serverless-bundling breakage. No table-layout
// library — rows are drawn manually, which is fine for STEP 10's simple
// tabular exports.
const PAGE_WIDTH = 792; // Letter, landscape
const PAGE_HEIGHT = 612;
const MARGIN = 36;
const ROW_HEIGHT = 16;
const FONT_SIZE = 8;

export async function buildPdfBuffer(columns: ColumnDef[], rows: Record<string, unknown>[], title: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const colWidth = (PAGE_WIDTH - MARGIN * 2) / Math.max(columns.length, 1);
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function drawHeaderRow(p: typeof page, yPos: number) {
    p.drawText(title, { x: MARGIN, y: PAGE_HEIGHT - MARGIN + 10, size: 12, font: boldFont, color: rgb(0.3, 0.05, 0.2) });
    columns.forEach((c, i) => {
      p.drawText(c.label.slice(0, 24), { x: MARGIN + i * colWidth, y: yPos, size: FONT_SIZE, font: boldFont });
    });
    return yPos - ROW_HEIGHT;
  }

  y = drawHeaderRow(page, y - 10);

  for (const row of rows) {
    if (y < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = drawHeaderRow(page, PAGE_HEIGHT - MARGIN - 10);
    }
    columns.forEach((c, i) => {
      const value = String(row[c.key] ?? "").slice(0, 30);
      page.drawText(value, { x: MARGIN + i * colWidth, y, size: FONT_SIZE, font });
    });
    y -= ROW_HEIGHT;
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

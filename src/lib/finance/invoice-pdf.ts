import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatMoney } from "@/lib/finance/money";

// Spec §17/§18 — a proper invoice/receipt layout (header, line items,
// totals), not the generic tabular report shape src/lib/reports/export/pdf.ts
// uses — same pdf-lib choice (embeds standard fonts, no fs font-file reads,
// avoids the pdfkit-under-serverless breakage that motivated the original
// choice). Never includes payment credentials — only amount/method/reference.
const PAGE_WIDTH = 612; // Letter, portrait
const PAGE_HEIGHT = 792;
const MARGIN = 50;

export interface InvoicePdfData {
  invoiceCode: string;
  invoiceDate: Date;
  customerName: string;
  customerCode: string;
  items: { description: string; quantity: number; unitPriceMinor: number; totalMinor: number }[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  currencyCode: string;
  paymentMethod: string;
  paymentReference: string | null;
  paymentStatus: string;
  appName: string;
}

export async function buildInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  let y = PAGE_HEIGHT - MARGIN;
  const money = (m: number) => formatMoney(m, data.currencyCode);

  page.drawText(data.appName, { x: MARGIN, y, size: 18, font: bold, color: rgb(0.3, 0.05, 0.2) });
  y -= 30;
  page.drawText(`Invoice ${data.invoiceCode}`, { x: MARGIN, y, size: 12, font: bold });
  y -= 16;
  page.drawText(`Date: ${data.invoiceDate.toLocaleDateString("en-US")}`, { x: MARGIN, y, size: 10, font });
  y -= 30;

  page.drawText(`Bill To: ${data.customerName} (${data.customerCode})`, { x: MARGIN, y, size: 10, font });
  y -= 30;

  page.drawText("Description", { x: MARGIN, y, size: 9, font: bold });
  page.drawText("Qty", { x: 350, y, size: 9, font: bold });
  page.drawText("Unit Price", { x: 400, y, size: 9, font: bold });
  page.drawText("Total", { x: 500, y, size: 9, font: bold });
  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.5 });
  y -= 16;

  for (const item of data.items) {
    page.drawText(item.description.slice(0, 45), { x: MARGIN, y, size: 9, font });
    page.drawText(String(item.quantity), { x: 350, y, size: 9, font });
    page.drawText(money(item.unitPriceMinor), { x: 400, y, size: 9, font });
    page.drawText(money(item.totalMinor), { x: 500, y, size: 9, font });
    y -= 16;
  }

  y -= 10;
  page.drawLine({ start: { x: 350, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.5 });
  y -= 18;

  const totalsRow = (label: string, value: string, boldLine = false) => {
    page.drawText(label, { x: 400, y, size: 9, font: boldLine ? bold : font });
    page.drawText(value, { x: 500, y, size: 9, font: boldLine ? bold : font });
    y -= 16;
  };
  totalsRow("Subtotal", money(data.subtotalMinor));
  if (data.discountMinor > 0) totalsRow("Discount", `-${money(data.discountMinor)}`);
  if (data.taxMinor > 0) totalsRow("Tax", money(data.taxMinor));
  totalsRow("Total", money(data.totalMinor), true);

  y -= 20;
  page.drawText(`Payment Method: ${data.paymentMethod}`, { x: MARGIN, y, size: 9, font });
  y -= 14;
  if (data.paymentReference) {
    page.drawText(`Payment Reference: ${data.paymentReference}`, { x: MARGIN, y, size: 9, font });
    y -= 14;
  }
  page.drawText(`Status: ${data.paymentStatus}`, { x: MARGIN, y, size: 9, font });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

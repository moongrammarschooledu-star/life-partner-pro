import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { buildInvoicePdf } from "@/lib/finance/invoice-pdf";
import { writeAudit } from "@/lib/audit";

// Spec §18 — authenticated, authorized, audited; never a predictable
// public invoice URL (the id is an opaque cuid, and ownership is checked
// server-side before any bytes are streamed).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { items: true, profile: { select: { fullName: true, profileCode: true } }, payment: true },
  });
  if (!invoice || invoice.profileId !== profileId) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const pdf = await buildInvoicePdf({
    invoiceCode: invoice.invoiceCode,
    invoiceDate: invoice.invoiceDate,
    customerName: invoice.profile.fullName,
    customerCode: invoice.profile.profileCode,
    items: invoice.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, totalMinor: i.totalMinor })),
    subtotalMinor: invoice.subtotalMinor,
    discountMinor: invoice.discountMinor,
    taxMinor: invoice.taxMinor,
    totalMinor: invoice.totalMinor,
    currencyCode: invoice.currencyCode,
    paymentMethod: invoice.payment?.method ?? "N/A",
    paymentReference: invoice.paymentReference,
    paymentStatus: invoice.paymentStatus,
    appName: settings?.appName ?? "Life Partner Pro",
  });

  await writeAudit({ action: "INVOICE_GENERATED", targetProfileId: profileId, meta: { invoiceId: invoice.id, event: "downloaded" } });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoice.invoiceCode}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

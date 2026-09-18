import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { notifyInvoiceCreated } from "@/lib/notifications/events";

// Spec §16/§47 — generated once a Payment is confirmed PAID; immutable
// once created (a correction is a new adjustment/credit record, never a
// silent edit — no update path is exposed anywhere for Invoice amounts).
export async function generateInvoice(orderId: string) {
  const existing = await prisma.invoice.findUnique({ where: { orderId } });
  if (existing) return existing;

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, payments: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!order) throw new Error("Order not found");
  const payment = order.payments[0];

  const invoiceCode = await nextSequenceCode("INV");
  const invoice = await prisma.invoice.create({
    data: {
      invoiceCode,
      orderId: order.id,
      profileId: order.profileId,
      paymentId: payment?.id ?? null,
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      taxMinor: order.taxMinor,
      totalMinor: order.totalMinor,
      currencyCode: order.currencyCode,
      paymentStatus: payment?.status ?? "PAID",
      paidDate: payment?.paidAt ?? new Date(),
      paymentReference: payment?.paymentCode ?? null,
      items: {
        create: order.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPriceMinor: item.unitPriceMinor,
          discountMinor: item.discountMinor,
          taxMinor: item.taxMinor,
          totalMinor: item.totalMinor,
        })),
      },
    },
  });

  await writeAudit({ action: "INVOICE_GENERATED", targetProfileId: order.profileId, meta: { invoiceId: invoice.id, orderId: order.id } });
  await notifyInvoiceCreated(order.profileId);

  return invoice;
}

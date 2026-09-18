import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { verifyManualPayment } from "@/lib/finance/manual-payment";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("finance:payments:manage");
    const { id } = await params;
    const result = await verifyManualPayment(id, admin.id);
    return NextResponse.json({ ok: true, invoiceId: result.invoice.id });
  } catch (error) {
    return handleApiError(error);
  }
}

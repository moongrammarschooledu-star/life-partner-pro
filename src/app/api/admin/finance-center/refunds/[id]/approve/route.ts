import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { approveRefund } from "@/lib/finance/refund";

// Spec §23 — "Authorized Admin" tier (ADMIN+, not STAFF).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("finance:refunds:approve");
    const { id } = await params;
    const refund = await approveRefund(id, admin.id);
    return NextResponse.json(refund);
  } catch (error) {
    return handleApiError(error);
  }
}

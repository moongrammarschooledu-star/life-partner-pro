import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { rejectManualPayment } from "@/lib/finance/manual-payment";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("finance:payments:manage");
    const { id } = await params;
    const { rejectionReason } = (await req.json()) as { rejectionReason?: string };
    if (!rejectionReason?.trim()) throw new ApiError(400, "A rejection reason is required.");

    await rejectManualPayment(id, admin.id, rejectionReason.trim());
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

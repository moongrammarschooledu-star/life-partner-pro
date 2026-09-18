import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

// Spec §44 — the Manual Payment Verification Queue.
export async function GET(req: Request) {
  try {
    await requireAdmin("finance:payments:manage");
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") ?? "PENDING_VERIFICATION";

    const items = await prisma.manualPaymentDetail.findMany({
      where: { status: status as never },
      include: { payment: { include: { profile: { select: { fullName: true, profileCode: true } }, order: { select: { orderCode: true, totalMinor: true, currencyCode: true } } } } },
      orderBy: { enteredAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

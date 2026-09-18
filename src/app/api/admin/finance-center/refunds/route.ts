import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { requestRefund } from "@/lib/finance/refund";
import type { RefundType } from "@prisma/client";

export async function GET(req: Request) {
  try {
    await requireAdmin("finance:refunds:view");
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    const refunds = await prisma.refund.findMany({
      where: status ? { status: status as never } : {},
      include: { payment: { include: { profile: { select: { fullName: true, profileCode: true } } } }, requestedBy: { select: { name: true } }, approvedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ items: refunds });
  } catch (error) {
    return handleApiError(error);
  }
}

// Spec §23 — finance:refunds:request (STAFF+); approval/execution are
// separate, higher-tier endpoints.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("finance:refunds:request");
    const { paymentId, amountMinor, type, reason } = (await req.json()) as { paymentId?: string; amountMinor?: number; type?: RefundType; reason?: string };

    if (!paymentId) throw new ApiError(400, "paymentId is required.");
    if (typeof amountMinor !== "number" || amountMinor <= 0) throw new ApiError(400, "A valid refund amount is required.");
    if (!type) throw new ApiError(400, "A refund type is required.");
    if (!reason?.trim()) throw new ApiError(400, "A reason is required.");

    const refund = await requestRefund({ paymentId, amountMinor, type, reason: reason.trim(), requestedById: admin.id });
    return NextResponse.json(refund);
  } catch (error) {
    return handleApiError(error);
  }
}

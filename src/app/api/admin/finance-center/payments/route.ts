import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { hasBroadRecordAccess } from "@/lib/permissions";

// Spec §36 — admin payment table. An assignment-scoped role only ever sees
// payments for profiles they're assigned to (row-scoped, same AdminAssignment
// join pattern used by every other assignment-scoped list in this codebase).
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("finance:payments:view");
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    const where: Record<string, unknown> = status ? { status } : {};

    if (!hasBroadRecordAccess(admin.role)) {
      const assigned = await prisma.adminAssignment.findMany({ where: { resourceType: "PROFILE", adminId: admin.id, status: { not: "REASSIGNED" } }, select: { resourceId: true } });
      where.profileId = { in: assigned.map((a) => a.resourceId) };
    }

    const payments = await prisma.payment.findMany({
      where,
      include: { profile: { select: { fullName: true, profileCode: true } }, order: { select: { orderCode: true } }, manualDetail: { select: { status: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json({
      items: payments.map((p) => ({
        id: p.id,
        paymentCode: p.paymentCode,
        profile: p.profile,
        orderCode: p.order.orderCode,
        amountMinor: p.amountMinor,
        currencyCode: p.currencyCode,
        method: p.method,
        provider: p.provider,
        status: p.status,
        createdAt: p.createdAt,
        manualStatus: p.manualDetail?.status ?? null,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

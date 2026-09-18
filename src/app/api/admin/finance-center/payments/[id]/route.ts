import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { logPrivacyAccess } from "@/lib/privacy/access-log";

// Spec §37 — Payment/Customer/Order/Invoice/Refunds/Timeline/Audit sections.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("finance:payments:view");
    const { id } = await params;

    if (admin.role === "STAFF") {
      const payment = await prisma.payment.findUnique({ where: { id }, select: { profileId: true } });
      if (payment) {
        const assigned = await prisma.adminAssignment.findFirst({ where: { resourceType: "PROFILE", resourceId: payment.profileId, adminId: admin.id, status: { not: "REASSIGNED" } } });
        if (!assigned) throw new ApiError(403, "You are not assigned to this profile.");
      }
    }

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        profile: { select: { fullName: true, profileCode: true } },
        order: { include: { items: true } },
        invoice: true,
        refunds: { include: { requestedBy: { select: { name: true } }, approvedBy: { select: { name: true } }, executedBy: { select: { name: true } } } },
        manualDetail: { include: { enteredBy: { select: { name: true } }, verifiedBy: { select: { name: true } } } },
        attempts: true,
      },
    });
    if (!payment) throw new ApiError(404, "Payment not found");

    await logPrivacyAccess({ actorAdminId: admin.id, action: "PAYMENT_VIEWED", field: "payment", targetProfileId: payment.profileId });

    return NextResponse.json(payment);
  } catch (error) {
    return handleApiError(error);
  }
}

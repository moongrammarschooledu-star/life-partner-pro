import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { hasBroadRecordAccess } from "@/lib/permissions";

export async function GET() {
  try {
    const admin = await requireAdmin("finance:invoices:view");
    const where: Record<string, unknown> = {};

    if (!hasBroadRecordAccess(admin.role)) {
      const assigned = await prisma.adminAssignment.findMany({ where: { resourceType: "PROFILE", adminId: admin.id, status: { not: "REASSIGNED" } }, select: { resourceId: true } });
      where.profileId = { in: assigned.map((a) => a.resourceId) };
    }

    const invoices = await prisma.invoice.findMany({
      where,
      include: { profile: { select: { fullName: true, profileCode: true } } },
      orderBy: { invoiceDate: "desc" },
      take: 100,
    });

    return NextResponse.json({ items: invoices });
  } catch (error) {
    return handleApiError(error);
  }
}

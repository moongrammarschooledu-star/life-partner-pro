import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("finance:coupons:manage");
    const { id } = await params;
    const { active } = (await req.json()) as { active?: boolean };

    const updated = await prisma.coupon.update({ where: { id }, data: { ...(active !== undefined ? { active } : {}) } });
    await writeAudit({ action: "COUPON_UPDATED", adminId: admin.id, meta: { couponId: id } });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

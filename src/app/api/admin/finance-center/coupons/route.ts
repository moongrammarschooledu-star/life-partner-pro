import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import type { DiscountType } from "@prisma/client";

export async function GET() {
  try {
    await requireAdmin("finance:coupons:view");
    const items = await prisma.coupon.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

// Spec §21 — backend validates every coupon; never trusts client-supplied
// discount values (enforced at redemption time in src/lib/finance/coupon.ts,
// not here — this route only creates the configuration).
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("finance:coupons:manage");
    const body = (await req.json()) as {
      code?: string; description?: string; discountType?: DiscountType; discountValue?: number;
      minPurchaseMinor?: number; maxDiscountMinor?: number; startDate?: string; endDate?: string;
      usageLimit?: number; perUserLimit?: number; applicablePackageIds?: string[];
    };

    if (!body.code?.trim()) throw new ApiError(400, "A coupon code is required.");
    if (!body.discountType) throw new ApiError(400, "A discount type is required.");
    if (typeof body.discountValue !== "number" || body.discountValue <= 0) throw new ApiError(400, "A valid discount value is required.");
    if (body.discountType === "PERCENTAGE" && body.discountValue > 100) throw new ApiError(400, "A percentage discount cannot exceed 100.");

    const discountCode = await nextSequenceCode("DISC");
    const coupon = await prisma.coupon.create({
      data: {
        discountCode,
        code: body.code.trim().toUpperCase(),
        description: body.description ?? null,
        discountType: body.discountType,
        discountValue: body.discountValue,
        minPurchaseMinor: body.minPurchaseMinor ?? null,
        maxDiscountMinor: body.maxDiscountMinor ?? null,
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        usageLimit: body.usageLimit ?? null,
        perUserLimit: body.perUserLimit ?? null,
        ...(body.applicablePackageIds ? { applicablePackageIds: body.applicablePackageIds } : {}),
        createdById: admin.id,
      },
    });

    await writeAudit({ action: "COUPON_CREATED", adminId: admin.id, meta: { couponId: coupon.id, code: coupon.code } });
    return NextResponse.json(coupon);
  } catch (error) {
    return handleApiError(error);
  }
}

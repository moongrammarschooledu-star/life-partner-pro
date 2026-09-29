import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { createPromotion, listPromotions } from "@/lib/promotions/promotion-service";
import type { PromotionType } from "@prisma/client";

export async function GET() {
  try {
    await requireAdmin("promotions:view");
    const items = await listPromotions();
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("promotions:manage");
    const { name, promotionType, config, startDate, endDate, packageIds, rules } = (await req.json()) as {
      name?: string; promotionType?: PromotionType; config?: Record<string, unknown>; startDate?: string; endDate?: string;
      packageIds?: string[]; rules?: Array<{ ruleType: string; ruleConfig: Record<string, unknown> }>;
    };
    if (!name?.trim() || !promotionType) throw new ApiError(400, "A name and promotion type are required.");

    const promotion = await createPromotion(admin.id, {
      name: name.trim(),
      promotionType,
      config: config ?? {},
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      packageIds,
      rules,
    });
    return NextResponse.json(promotion);
  } catch (error) {
    return handleApiError(error);
  }
}

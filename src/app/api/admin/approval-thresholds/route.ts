import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { isKnownActionType } from "@/lib/approvals/catalog";
import { isValidAmount } from "@/lib/finance/money";
import type { ApprovalLevel } from "@prisma/client";

// STEP 19 §10 — currency-aware, admin-configurable financial approval
// tiers. Amounts are integer minor units (src/lib/finance/money.ts's
// convention) — never floating point.
export async function GET(req: Request) {
  try {
    await requireAdmin("approvals:policy:view");
    const { searchParams } = new URL(req.url);
    const actionType = searchParams.get("actionType");
    const items = await prisma.approvalAmountThreshold.findMany({
      where: actionType ? { actionType } : undefined,
      orderBy: [{ actionType: "asc" }, { minAmountMinor: "asc" }],
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin("approvals:policy:manage");
    const body = (await req.json()) as {
      actionType?: string;
      currencyCode?: string;
      minAmountMinor?: number;
      maxAmountMinor?: number | null;
      requiredLevel?: ApprovalLevel;
      minimumApprovers?: number;
    };

    if (!body.actionType || !isKnownActionType(body.actionType)) throw new ApiError(400, "A valid actionType is required.");
    if (!body.currencyCode?.trim()) throw new ApiError(400, "currencyCode is required.");
    if (!isValidAmount(body.minAmountMinor)) throw new ApiError(400, "minAmountMinor must be a non-negative integer.");
    if (body.maxAmountMinor != null && !isValidAmount(body.maxAmountMinor)) throw new ApiError(400, "maxAmountMinor must be a non-negative integer.");
    if (!body.requiredLevel) throw new ApiError(400, "requiredLevel is required.");

    const threshold = await prisma.approvalAmountThreshold.create({
      data: {
        actionType: body.actionType,
        currencyCode: body.currencyCode.trim().toUpperCase(),
        minAmountMinor: body.minAmountMinor!,
        maxAmountMinor: body.maxAmountMinor ?? null,
        requiredLevel: body.requiredLevel,
        minimumApprovers: body.minimumApprovers ?? 1,
      },
    });
    return NextResponse.json(threshold);
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { grantCredit, revokeCredit } from "@/lib/finance/credits";

export async function GET(req: Request) {
  try {
    await requireAdmin("finance:credits:view");
    const { searchParams } = new URL(req.url);
    const profileId = searchParams.get("profileId");
    const where = profileId ? { profileId } : {};
    const items = await prisma.membershipCredit.findMany({ where, include: { transactions: { orderBy: { createdAt: "desc" }, take: 20 } } });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("finance:credits:manage");
    const { profileId, currencyCode, amountMinor, reason } = (await req.json()) as { profileId?: string; currencyCode?: string; amountMinor?: number; reason?: string };
    if (!profileId || !currencyCode) throw new ApiError(400, "A profile and currency are required.");
    if (typeof amountMinor !== "number" || amountMinor <= 0 || !Number.isInteger(amountMinor)) throw new ApiError(400, "A valid positive amount is required.");
    if (!reason?.trim()) throw new ApiError(400, "A reason is required.");

    const credit = await grantCredit({ profileId, currencyCode, amountMinor, reason: reason.trim(), referenceType: "ADMIN_ADJUST", createdById: admin.id });
    return NextResponse.json(credit);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const admin = await requireAdmin("finance:credits:manage");
    const { profileId, currencyCode, amountMinor, reason } = (await req.json()) as { profileId?: string; currencyCode?: string; amountMinor?: number; reason?: string };
    if (!profileId || !currencyCode) throw new ApiError(400, "A profile and currency are required.");
    if (typeof amountMinor !== "number" || amountMinor <= 0 || !Number.isInteger(amountMinor)) throw new ApiError(400, "A valid positive amount is required.");
    if (!reason?.trim()) throw new ApiError(400, "A reason is required.");

    const credit = await revokeCredit(admin.id, profileId, currencyCode, amountMinor, reason.trim());
    return NextResponse.json({ credit });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

// Spec §46 — never overwrites historical pricing. A price "change" is
// always a new row; the old row is deactivated but never deleted or
// mutated, so existing invoices that reference the old amount stay
// accurate forever.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("finance:packages:manage");
    const { id } = await params;
    const { amountMinor, currencyCode, taxInclusive } = (await req.json()) as { amountMinor?: number; currencyCode?: string; taxInclusive?: boolean };

    if (typeof amountMinor !== "number" || amountMinor < 0 || !Number.isInteger(amountMinor)) throw new ApiError(400, "A valid price amount is required.");
    if (!currencyCode) throw new ApiError(400, "A currency is required.");

    const [, newPrice] = await prisma.$transaction([
      prisma.packagePrice.updateMany({ where: { packageId: id, active: true }, data: { active: false } }),
      prisma.packagePrice.create({ data: { packageId: id, amountMinor, currencyCode, taxInclusive: !!taxInclusive, createdById: admin.id } }),
    ]);

    await writeAudit({ action: "PACKAGE_PRICE_CHANGED", adminId: admin.id, meta: { packageId: id, newPriceId: newPrice.id, amountMinor, currencyCode } });

    return NextResponse.json(newPrice);
  } catch (error) {
    return handleApiError(error);
  }
}

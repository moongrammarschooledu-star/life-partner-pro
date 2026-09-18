import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";

// Spec §19 — no hard-coded tax rate; Super Admin configures rules.
export async function GET() {
  try {
    await requireAdmin("finance:coupons:view"); // tax rules share the same "financial configuration" viewing tier
    const items = await prisma.taxRule.findMany({ orderBy: { effectiveDate: "desc" } });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("finance:coupons:manage");
    const { name, ratePercentBasisPoints, country, region, applicableService, effectiveDate, expiryDate } = (await req.json()) as {
      name?: string; ratePercentBasisPoints?: number; country?: string; region?: string; applicableService?: string; effectiveDate?: string; expiryDate?: string;
    };

    if (!name?.trim()) throw new ApiError(400, "A tax name is required.");
    if (typeof ratePercentBasisPoints !== "number" || ratePercentBasisPoints < 0) throw new ApiError(400, "A valid tax rate is required.");
    if (!country?.trim()) throw new ApiError(400, "A country is required.");

    const rule = await prisma.taxRule.create({
      data: {
        name: name.trim(),
        ratePercentBasisPoints,
        country: country.trim(),
        region: region ?? null,
        applicableService: applicableService ?? null,
        effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        createdById: admin.id,
      },
    });

    return NextResponse.json(rule);
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Public package browser — no auth required to see what's available,
// mirroring how registration itself is public.
export async function GET() {
  const packages = await prisma.package.findMany({
    where: { active: true },
    include: { prices: { where: { active: true }, orderBy: { effectiveFrom: "desc" }, take: 1 }, entitlements: true },
    orderBy: { displayOrder: "asc" },
  });

  return NextResponse.json({
    items: packages.map((p) => ({
      id: p.id,
      packageCode: p.packageCode,
      name: p.name,
      description: p.description,
      billingType: p.billingType,
      durationDays: p.durationDays,
      trialDays: p.trialDays,
      price: p.prices[0] ? { amountMinor: p.prices[0].amountMinor, currencyCode: p.prices[0].currencyCode } : null,
      features: p.entitlements.map((e) => e.featureKey),
    })),
  });
}

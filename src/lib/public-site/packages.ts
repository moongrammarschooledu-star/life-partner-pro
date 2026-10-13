import { prisma } from "@/lib/prisma";

export interface PublicPackage {
  id: string;
  packageCode: string;
  name: string;
  description: string;
  billingType: string;
  durationDays: number | null;
  trialDays: number;
  price: { amountMinor: number; currencyCode: string } | null;
  features: string[];
}

// The one place that turns the membership configuration (STEP 14 / 27) into what the public may see: active packages, their current price
// and the feature keys. Used by the public package API, the pricing page and the home page, so all three always agree.
export async function getPublicPackages(): Promise<PublicPackage[]> {
  const packages = await prisma.package.findMany({
    where: { active: true },
    include: { prices: { where: { active: true }, orderBy: { effectiveFrom: "desc" }, take: 1 }, entitlements: true },
    orderBy: { displayOrder: "asc" },
  });
  return packages.map((p) => ({
    id: p.id,
    packageCode: p.packageCode,
    name: p.name,
    description: p.description,
    billingType: p.billingType,
    durationDays: p.durationDays,
    trialDays: p.trialDays,
    price: p.prices[0] ? { amountMinor: p.prices[0].amountMinor, currencyCode: p.prices[0].currencyCode } : null,
    features: p.entitlements.map((e) => e.featureKey),
  }));
}

/** For pages that render at build time or from cache: a database problem must never break a marketing page. */
export async function getPublicPackagesSafe(): Promise<PublicPackage[]> {
  try {
    return await getPublicPackages();
  } catch {
    return [];
  }
}

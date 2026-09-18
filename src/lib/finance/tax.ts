import { prisma } from "@/lib/prisma";
import { applyBasisPoints } from "@/lib/finance/money";

// Spec §19 — no hard-coded tax rate; Super Admin configures TaxRule rows.
// computeTax() is pure given an already-resolved rule; resolveTaxRule()
// does the DB lookup.
export function computeTax(amountMinor: number, ratePercentBasisPoints: number): number {
  return applyBasisPoints(amountMinor, ratePercentBasisPoints);
}

export async function resolveTaxRule(country: string, applicableService: string | null, date: Date = new Date()) {
  return prisma.taxRule.findFirst({
    where: {
      country,
      active: true,
      effectiveDate: { lte: date },
      OR: [{ expiryDate: null }, { expiryDate: { gte: date } }],
      AND: [{ OR: [{ applicableService: null }, { applicableService }] }],
    },
    orderBy: { effectiveDate: "desc" },
  });
}

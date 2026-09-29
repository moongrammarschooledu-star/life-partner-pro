import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { resolveCouponForOrder } from "@/lib/finance/coupon";

// STEP 27 §32 — every condition is checked server-side; the client never
// computes or trusts its own discount preview.
export async function POST(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const limited = await enforceConfiguredLimit(req, "my-coupons-validate", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const { code, packageId } = (await req.json()) as { code?: string; packageId?: string };
  if (!code?.trim() || !packageId) return NextResponse.json({ error: "A coupon code and package are required." }, { status: 400 });

  const pkg = await prisma.package.findUnique({ where: { id: packageId }, include: { prices: { where: { active: true }, orderBy: { effectiveFrom: "desc" }, take: 1 } } });
  if (!pkg || !pkg.prices[0]) return NextResponse.json({ error: "This package is not currently available." }, { status: 404 });

  const isFirstTimeUser = !(await prisma.order.findFirst({ where: { profileId, status: { in: ["PAID", "COMPLETED"] } } }));
  const result = await resolveCouponForOrder(code.trim(), profileId, packageId, pkg.prices[0].amountMinor, {
    currencyCode: pkg.prices[0].currencyCode,
    isFirstTimeUser,
    subscriptionType: pkg.packageType,
  });

  if (!result.ok) return NextResponse.json({ valid: false, reason: result.reason });
  return NextResponse.json({ valid: true, discountMinor: result.discountMinor });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { getUserEntitlements, checkFeatureAccess, listActiveOverrides } from "@/lib/finance/entitlements";
import { getBalance } from "@/lib/finance/credits";
import { getReferralSummary } from "@/lib/referrals/referral-service";

// STEP 27 §62 — the single membership overview: current plan, usage,
// entitlements, credits, referral summary. Never a frontend-only counter —
// every figure here is re-derived server-side via the same services the
// enforcement paths use (checkFeatureAccess, getBalance, etc.).
export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const subscription = await prisma.subscription.findFirst({
    where: { profileId, status: { in: ["ACTIVE", "TRIAL", "PAST_DUE", "GRACE_PERIOD", "PENDING"] } },
    include: { package: true },
    orderBy: { createdAt: "desc" },
  });

  const entitlements = await getUserEntitlements(profileId);
  const usage = await Promise.all(entitlements.map(async (e) => ({ featureKey: e.featureKey, limitValue: e.limitValue, ...(await checkFeatureAccess(profileId, e.featureKey)) })));

  const overrides = await listActiveOverrides(profileId);
  const currencyCode = subscription?.package ? (await prisma.packagePrice.findFirst({ where: { packageId: subscription.packageId }, orderBy: { effectiveFrom: "desc" } }))?.currencyCode ?? "PKR" : "PKR";
  const creditBalanceMinor = await getBalance(profileId, currencyCode);
  const referralSummary = await getReferralSummary(profileId);

  return NextResponse.json({
    subscription: subscription
      ? {
          subscriptionCode: subscription.subscriptionCode,
          status: subscription.status,
          startDate: subscription.startDate,
          endDate: subscription.endDate,
          renewalDate: subscription.renewalDate,
          autoRenew: subscription.autoRenew,
          trialEndsAt: subscription.trialEndsAt,
          package: { name: subscription.package.name, packageType: subscription.package.packageType, billingType: subscription.package.billingType },
        }
      : null,
    usage,
    overrides: overrides.map((o) => ({ featureKey: o.featureKey, overrideType: o.overrideType, limitValue: o.limitValue, expiresAt: o.expiresAt, reason: o.reason })),
    credit: { balanceMinor: creditBalanceMinor, currencyCode },
    referral: referralSummary,
  });
}

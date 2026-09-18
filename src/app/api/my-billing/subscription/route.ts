import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { cancelSubscription } from "@/lib/finance/subscription";
import { getUserEntitlements, getRemainingUsage } from "@/lib/finance/entitlements";

// Spec §10 — My Subscription: package/status/dates/features/usage/history.
export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const subscription = await prisma.subscription.findFirst({
    where: { profileId, status: { in: ["ACTIVE", "TRIAL", "PAST_DUE", "GRACE_PERIOD", "PENDING"] } },
    include: { package: { include: { entitlements: true } } },
    orderBy: { createdAt: "desc" },
  });

  if (!subscription) return NextResponse.json({ subscription: null });

  const entitlements = await getUserEntitlements(profileId);
  const usage = await Promise.all(
    entitlements.map(async (e) => ({ featureKey: e.featureKey, limitValue: e.limitValue, remaining: await getRemainingUsage(profileId, e.featureKey) }))
  );

  return NextResponse.json({
    subscription: {
      subscriptionCode: subscription.subscriptionCode,
      status: subscription.status,
      startDate: subscription.startDate,
      endDate: subscription.endDate,
      renewalDate: subscription.renewalDate,
      autoRenew: subscription.autoRenew,
      package: { name: subscription.package.name, billingType: subscription.package.billingType },
      usage,
    },
  });
}

export async function DELETE(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { reason, immediate } = (await req.json().catch(() => ({}))) as { reason?: string; immediate?: boolean };

  const subscription = await prisma.subscription.findFirst({ where: { profileId, status: { in: ["ACTIVE", "TRIAL", "PAST_DUE", "GRACE_PERIOD"] } } });
  if (!subscription) return NextResponse.json({ error: "No active subscription found." }, { status: 404 });

  await cancelSubscription(subscription.id, reason ?? "Cancelled by user", !!immediate);
  return NextResponse.json({ ok: true });
}

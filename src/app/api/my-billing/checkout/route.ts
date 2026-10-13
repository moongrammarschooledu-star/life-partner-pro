import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { startCheckout, CheckoutError } from "@/lib/finance/checkout";
import { withRequestMetrics } from "@/lib/observability/metrics";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { parseAppUserAgent } from "@/lib/mobile/version";

async function postHandler(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // STEP 37 — store rules decide whether the apps may sell memberships. Until the owner has settled that (and switched mobile.payments.enabled on), a
  // purchase cannot be started from inside the Android or iPhone app. The website is unaffected, and what a person is entitled to is still decided by the server.
  if (parseAppUserAgent(req.headers.get("user-agent")) && !(await isFeatureEnabled("mobile.payments.enabled"))) {
    return NextResponse.json({ error: "Purchases are not available in the app.", code: "APP_PURCHASES_OFF" }, { status: 403 });
  }

  const limited = await enforceConfiguredLimit(req, "my-billing-checkout", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const { packageId, couponCode } = (await req.json()) as { packageId?: string; couponCode?: string };
  if (!packageId) return NextResponse.json({ error: "A package is required." }, { status: 400 });

  const profile = await prisma.profile.findUnique({ where: { id: profileId }, select: { country: true } });

  try {
    const { order, payment, checkout } = await startCheckout({ profileId, packageId, couponCode, country: profile?.country ?? "PK" });
    return NextResponse.json({
      orderCode: order.orderCode,
      paymentId: payment.id,
      paymentCode: payment.paymentCode,
      amountMinor: payment.amountMinor,
      currencyCode: payment.currencyCode,
      instructions: checkout.instructions,
      redirectUrl: checkout.redirectUrl,
      providerReference: checkout.providerReference,
    });
  } catch (error) {
    if (error instanceof CheckoutError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error(error);
    return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 500 });
  }
}

// STEP 15 §17 — latency/error buckets for this critical route (System Health → Performance).
export const POST = withRequestMetrics("POST /api/my-billing/checkout", postHandler);

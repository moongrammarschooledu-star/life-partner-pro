import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { startCheckout, CheckoutError } from "@/lib/finance/checkout";

export async function POST(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const key = `my-billing-checkout:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests. Please try again in a minute." }, { status: 429 });
  }

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

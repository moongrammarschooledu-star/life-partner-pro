import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { addMoney, subtractMoney } from "@/lib/finance/money";
import { resolveCouponForOrder } from "@/lib/finance/coupon";
import { computeTax, resolveTaxRule } from "@/lib/finance/tax";
import { getActiveProvider } from "@/lib/finance/providers/registry";
import { assertPaymentsAvailable, PaymentsUnavailableError } from "@/lib/finance/rollout";

export class CheckoutError extends Error {}

// Spec §7/§12/§60 — never trusts a client-supplied price, discount, or tax.
// Re-fetches the package's current PackagePrice, re-validates any coupon
// server-side, and re-computes tax from the active TaxRule. Nothing beyond
// creating a Created-status Payment happens here — activation only occurs
// once a webhook or admin-verified manual payment confirms PAID (spec §12).
//
// The rollout-phases gate (spec §70/§73) runs first, before any of that —
// its PaymentsUnavailableError is re-thrown as a CheckoutError so existing
// callers' error handling needs no change.
export async function startCheckout(params: { profileId: string; packageId: string; couponCode?: string; country: string }) {
  try {
    await assertPaymentsAvailable({ id: params.profileId, country: params.country }, params.packageId);
  } catch (error) {
    if (error instanceof PaymentsUnavailableError) throw new CheckoutError(error.message);
    throw error;
  }

  const pkg = await prisma.package.findUnique({ where: { id: params.packageId }, include: { prices: { where: { active: true }, orderBy: { effectiveFrom: "desc" }, take: 1 } } });
  if (!pkg || !pkg.active) throw new CheckoutError("This package is not currently available.");
  const price = pkg.prices[0];
  if (!price) throw new CheckoutError("This package has no active price configured.");

  const subtotalMinor = price.amountMinor;
  let discountMinor = 0;
  let couponId: string | undefined;

  if (params.couponCode) {
    const result = await resolveCouponForOrder(params.couponCode, params.profileId, params.packageId, subtotalMinor);
    if (!result.ok) throw new CheckoutError(result.reason);
    discountMinor = result.discountMinor;
    couponId = result.couponId;
  }

  const taxableAmount = subtractMoney(subtotalMinor, discountMinor);
  const taxRule = await resolveTaxRule(params.country, "package");
  const taxMinor = taxRule ? computeTax(taxableAmount, taxRule.ratePercentBasisPoints) : 0;
  const totalMinor = addMoney(taxableAmount, taxMinor);

  const orderCode = await nextSequenceCode("ORD");
  const order = await prisma.order.create({
    data: {
      orderCode,
      profileId: params.profileId,
      status: "PENDING_PAYMENT",
      currencyCode: price.currencyCode,
      subtotalMinor,
      discountMinor,
      taxMinor,
      totalMinor,
      couponId: couponId ?? null,
      items: {
        create: {
          packageId: pkg.id,
          packagePriceId: price.id,
          description: pkg.name,
          quantity: 1,
          unitPriceMinor: subtotalMinor,
          discountMinor,
          taxMinor,
          totalMinor,
        },
      },
    },
  });

  if (couponId) {
    await prisma.couponRedemption.create({ data: { couponId, profileId: params.profileId, orderId: order.id, discountAppliedMinor: discountMinor } });
  }

  const paymentCode = await nextSequenceCode("PAY");
  const provider = await getActiveProvider();
  const payment = await prisma.payment.create({
    data: {
      paymentCode,
      orderId: order.id,
      profileId: params.profileId,
      amountMinor: totalMinor,
      currencyCode: price.currencyCode,
      method: provider.name === "MANUAL" ? "MANUAL" : "CARD",
      provider: provider.name,
      status: "CREATED",
    },
  });

  const checkout = await provider.createCheckout({ paymentId: payment.id, amountMinor: totalMinor, currencyCode: price.currencyCode, description: pkg.name });

  await prisma.payment.update({ where: { id: payment.id }, data: { status: "PENDING" } });
  await writeAudit({ action: "PAYMENT_STATUS_CHANGED", targetProfileId: params.profileId, meta: { paymentId: payment.id, orderId: order.id, status: "PENDING" } });

  return { order, payment, checkout };
}

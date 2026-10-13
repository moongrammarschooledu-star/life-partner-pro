// Display helpers for the public pricing page. Pure, so the Free / One-time / Subscription wording is tested.

export function billingPeriodLabel(billingType: string, durationDays: number | null): string {
  if (billingType === "ONE_TIME") return "One-time payment";
  if (durationDays && durationDays > 0) {
    if (durationDays % 365 === 0) return `Subscription, every ${durationDays / 365 === 1 ? "year" : `${durationDays / 365} years`}`;
    if (durationDays % 30 === 0) return `Subscription, every ${durationDays / 30 === 1 ? "month" : `${durationDays / 30} months`}`;
    return `Subscription, every ${durationDays} days`;
  }
  return "Subscription";
}

/** `price` null means no active price is configured: the page says "Contact us" rather than inventing a number. */
export function priceLabel(price: { amountMinor: number; currencyCode: string } | null, format: (amountMinor: number, currencyCode: string) => string): { text: string; isFree: boolean } {
  if (!price) return { text: "Contact us", isFree: false };
  if (price.amountMinor === 0) return { text: format(0, price.currencyCode), isFree: true };
  return { text: format(price.amountMinor, price.currencyCode), isFree: false };
}

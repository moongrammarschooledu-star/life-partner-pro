// Spec §4 — every amount is an integer minor-unit amount (e.g. paisa/cents),
// never a Float. This is the ONLY place arithmetic on money happens in this
// codebase; every other module imports these rather than doing `* 1.17` or
// similar float math directly.

const CURRENCY_SYMBOLS: Record<string, string> = {
  PKR: "Rs.",
  USD: "$",
  GBP: "£",
  EUR: "€",
  AED: "AED ",
  SAR: "SAR ",
};

export function isValidAmount(amountMinor: unknown): amountMinor is number {
  return typeof amountMinor === "number" && Number.isInteger(amountMinor) && amountMinor >= 0;
}

export function addMoney(...amountsMinor: number[]): number {
  return amountsMinor.reduce((sum, amount) => sum + amount, 0);
}

export function subtractMoney(a: number, b: number): number {
  return Math.max(0, a - b);
}

// Percent is expressed in basis points (1/100 of a percent) to avoid float
// error — e.g. 1700 = 17.00%. Result is rounded to the nearest minor unit.
export function applyBasisPoints(amountMinor: number, basisPoints: number): number {
  return Math.round((amountMinor * basisPoints) / 10000);
}

// Percentage discount expressed as a whole integer 0-100.
export function applyPercent(amountMinor: number, percent: number): number {
  return Math.round((amountMinor * percent) / 100);
}

export function formatMoney(amountMinor: number, currencyCode: string, decimalPrecision = 2): string {
  const symbol = CURRENCY_SYMBOLS[currencyCode] ?? `${currencyCode} `;
  const divisor = 10 ** decimalPrecision;
  const major = amountMinor / divisor;
  return `${symbol}${major.toLocaleString("en-US", { minimumFractionDigits: decimalPrecision, maximumFractionDigits: decimalPrecision })}`;
}

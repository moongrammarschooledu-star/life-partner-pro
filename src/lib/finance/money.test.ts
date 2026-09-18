import { describe, it, expect } from "vitest";
import { isValidAmount, addMoney, subtractMoney, applyBasisPoints, applyPercent, formatMoney } from "./money";

describe("isValidAmount", () => {
  it("accepts a non-negative integer", () => {
    expect(isValidAmount(500000)).toBe(true);
    expect(isValidAmount(0)).toBe(true);
  });
  it("rejects negative numbers, non-integers, and non-numbers", () => {
    expect(isValidAmount(-1)).toBe(false);
    expect(isValidAmount(10.5)).toBe(false);
    expect(isValidAmount("500" as unknown)).toBe(false);
    expect(isValidAmount(undefined)).toBe(false);
  });
});

describe("addMoney / subtractMoney", () => {
  it("sums multiple minor-unit amounts exactly", () => {
    expect(addMoney(100, 200, 300)).toBe(600);
    expect(addMoney()).toBe(0);
  });
  it("subtracts and floors at zero rather than going negative", () => {
    expect(subtractMoney(1000, 400)).toBe(600);
    expect(subtractMoney(100, 500)).toBe(0);
  });
});

describe("applyBasisPoints (tax)", () => {
  it("computes 17.00% (1700 bps) of an amount", () => {
    expect(applyBasisPoints(100000, 1700)).toBe(17000);
  });
  it("computes 0% as zero", () => {
    expect(applyBasisPoints(100000, 0)).toBe(0);
  });
  it("rounds to the nearest minor unit rather than truncating with float error", () => {
    // 333 * 1/3% (33.33 bps) -> exact float math would drift; rounding must be stable
    expect(applyBasisPoints(333, 3333)).toBe(Math.round((333 * 3333) / 10000));
  });
});

describe("applyPercent (discount)", () => {
  it("computes a 10% discount on a whole-number amount", () => {
    expect(applyPercent(100000, 10)).toBe(10000);
  });
  it("rounds a fractional-minor-unit result", () => {
    expect(applyPercent(999, 33)).toBe(Math.round((999 * 33) / 100));
  });
});

describe("formatMoney", () => {
  it("formats PKR with the correct symbol and precision", () => {
    expect(formatMoney(500000, "PKR")).toBe("Rs.5,000.00");
  });
  it("formats USD with two decimal places", () => {
    expect(formatMoney(1099, "USD")).toBe("$10.99");
  });
  it("falls back to the currency code as a symbol for an unknown currency", () => {
    expect(formatMoney(100, "XYZ")).toBe("XYZ 1.00");
  });
});

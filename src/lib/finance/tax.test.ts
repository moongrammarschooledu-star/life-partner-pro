import { describe, it, expect } from "vitest";
import { computeTax } from "./tax";

describe("computeTax", () => {
  it("computes a 17% tax (1700 basis points)", () => {
    expect(computeTax(100000, 1700)).toBe(17000);
  });

  it("computes zero tax for a zero rate", () => {
    expect(computeTax(100000, 0)).toBe(0);
  });

  it("rounds to the nearest minor unit", () => {
    expect(computeTax(333, 1550)).toBe(Math.round((333 * 1550) / 10000));
  });
});

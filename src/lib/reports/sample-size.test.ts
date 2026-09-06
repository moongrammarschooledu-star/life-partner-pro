import { describe, it, expect } from "vitest";
import { safeRate, MIN_SAMPLE_SIZE } from "@/lib/reports/sample-size";

describe("safeRate", () => {
  it("returns null when the denominator is zero", () => {
    expect(safeRate(0, 0)).toBeNull();
  });

  it("returns null when the denominator is below the minimum sample size", () => {
    expect(safeRate(1, MIN_SAMPLE_SIZE - 1)).toBeNull();
  });

  it("returns a rounded percentage at exactly the minimum sample size", () => {
    expect(safeRate(1, MIN_SAMPLE_SIZE)).toBe(20);
  });

  it("returns a rounded percentage above the minimum sample size", () => {
    expect(safeRate(3, 10)).toBe(30);
    expect(safeRate(2, 6)).toBe(33);
  });

  it("handles a 100% rate", () => {
    expect(safeRate(10, 10)).toBe(100);
  });
});

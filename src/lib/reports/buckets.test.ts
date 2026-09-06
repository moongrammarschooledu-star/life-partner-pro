import { describe, it, expect } from "vitest";
import { assignRangeBucket, DEFAULT_AGE_BUCKETS, DEFAULT_INCOME_BUCKETS } from "@/lib/reports/buckets";

describe("assignRangeBucket — age", () => {
  it("assigns the lowest bucket for a value under the first floor", () => {
    expect(assignRangeBucket(18, DEFAULT_AGE_BUCKETS)).toBe("Under 20");
  });

  it("assigns boundary values to the correct bucket", () => {
    expect(assignRangeBucket(19, DEFAULT_AGE_BUCKETS)).toBe("Under 20");
    expect(assignRangeBucket(20, DEFAULT_AGE_BUCKETS)).toBe("20–24");
    expect(assignRangeBucket(24, DEFAULT_AGE_BUCKETS)).toBe("20–24");
    expect(assignRangeBucket(25, DEFAULT_AGE_BUCKETS)).toBe("25–29");
  });

  it("assigns the open-ended top bucket", () => {
    expect(assignRangeBucket(50, DEFAULT_AGE_BUCKETS)).toBe("50+");
    expect(assignRangeBucket(90, DEFAULT_AGE_BUCKETS)).toBe("50+");
  });
});

describe("assignRangeBucket — income", () => {
  it("assigns below the floor and at exact boundaries correctly", () => {
    expect(assignRangeBucket(0, DEFAULT_INCOME_BUCKETS)).toBe("Below 50K");
    expect(assignRangeBucket(49_999, DEFAULT_INCOME_BUCKETS)).toBe("Below 50K");
    expect(assignRangeBucket(50_000, DEFAULT_INCOME_BUCKETS)).toBe("50K–100K");
    expect(assignRangeBucket(500_000, DEFAULT_INCOME_BUCKETS)).toBe("500K+");
    expect(assignRangeBucket(10_000_000, DEFAULT_INCOME_BUCKETS)).toBe("500K+");
  });
});

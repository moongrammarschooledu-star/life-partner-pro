import { describe, it, expect } from "vitest";
import { bucketByDay, bucketByDayMultiSeries } from "@/lib/reports/day-bucketing";

describe("bucketByDay", () => {
  it("groups rows into day buckets sorted ascending", () => {
    const rows = [
      { createdAt: new Date("2026-09-02T10:00:00Z") },
      { createdAt: new Date("2026-09-01T08:00:00Z") },
      { createdAt: new Date("2026-09-01T23:00:00Z") },
    ];
    expect(bucketByDay(rows, (r) => r.createdAt)).toEqual([
      { label: "2026-09-01", count: 2 },
      { label: "2026-09-02", count: 1 },
    ]);
  });

  it("returns an empty array for no rows", () => {
    expect(bucketByDay([], (r: { createdAt: Date }) => r.createdAt)).toEqual([]);
  });
});

describe("bucketByDayMultiSeries", () => {
  it("splits counts per series key within each day", () => {
    const rows = [
      { createdAt: new Date("2026-09-01T00:00:00Z"), status: "NEW" },
      { createdAt: new Date("2026-09-01T01:00:00Z"), status: "VERIFIED" },
      { createdAt: new Date("2026-09-01T02:00:00Z"), status: "NEW" },
      { createdAt: new Date("2026-09-02T00:00:00Z"), status: "VERIFIED" },
    ];
    expect(bucketByDayMultiSeries(rows, (r) => r.createdAt, (r) => r.status)).toEqual([
      { label: "2026-09-01", series: { NEW: 2, VERIFIED: 1 } },
      { label: "2026-09-02", series: { VERIFIED: 1 } },
    ]);
  });
});

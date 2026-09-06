import { describe, it, expect } from "vitest";
import { computeNextRunAt } from "@/lib/reports/scheduler";

describe("computeNextRunAt — DAILY", () => {
  it("schedules later today when the target hour hasn't passed yet", () => {
    const from = new Date("2026-09-15T05:00:00.000Z");
    const next = computeNextRunAt("DAILY", null, null, 8, from);
    expect(next.toISOString()).toBe("2026-09-15T08:00:00.000Z");
  });

  it("rolls over to tomorrow when the target hour has already passed", () => {
    const from = new Date("2026-09-15T09:00:00.000Z");
    const next = computeNextRunAt("DAILY", null, null, 8, from);
    expect(next.toISOString()).toBe("2026-09-16T08:00:00.000Z");
  });
});

describe("computeNextRunAt — WEEKLY", () => {
  it("finds the next occurrence of the target day of week", () => {
    // 2026-09-15 is a Tuesday (day 2); target Monday (day 1) should roll to next week.
    const from = new Date("2026-09-15T05:00:00.000Z");
    const next = computeNextRunAt("WEEKLY", 1, null, 9, from);
    expect(next.getUTCDay()).toBe(1);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });

  it("defaults to Monday when no dayOfWeek is given", () => {
    const from = new Date("2026-09-15T05:00:00.000Z");
    const next = computeNextRunAt("WEEKLY", null, null, 9, from);
    expect(next.getUTCDay()).toBe(1);
  });
});

describe("computeNextRunAt — MONTHLY", () => {
  it("finds the target day within the current month when still ahead", () => {
    const from = new Date("2026-09-01T05:00:00.000Z");
    const next = computeNextRunAt("MONTHLY", null, 15, 9, from);
    expect(next.toISOString()).toBe("2026-09-15T09:00:00.000Z");
  });

  it("rolls over to next month when the target day has already passed", () => {
    const from = new Date("2026-09-20T05:00:00.000Z");
    const next = computeNextRunAt("MONTHLY", null, 15, 9, from);
    expect(next.getUTCMonth()).toBe(9); // October (0-indexed)
    expect(next.getUTCDate()).toBe(15);
  });

  it("caps dayOfMonth at 28 to dodge month-length edge cases", () => {
    const from = new Date("2026-09-01T05:00:00.000Z");
    const next = computeNextRunAt("MONTHLY", null, 31, 9, from);
    expect(next.getUTCDate()).toBe(28);
  });
});

import { describe, it, expect } from "vitest";
import { resolveDateRange } from "@/lib/reports/date-range";

const NOW = new Date("2026-09-15T12:00:00.000Z");

describe("resolveDateRange", () => {
  it("resolves 'today' to the start/end of the current day", () => {
    const { from, to } = resolveDateRange("today", null, null, NOW);
    expect(from.toISOString().slice(0, 10)).toBe("2026-09-15");
    expect(to.toISOString().slice(0, 10)).toBe("2026-09-15");
  });

  it("resolves 'yesterday' to the previous calendar day", () => {
    const { from, to } = resolveDateRange("yesterday", null, null, NOW);
    expect(from.toISOString().slice(0, 10)).toBe("2026-09-14");
    expect(to.toISOString().slice(0, 10)).toBe("2026-09-14");
  });

  it("resolves '7d' to a 7-day inclusive window ending today", () => {
    const { from, to } = resolveDateRange("7d", null, null, NOW);
    expect(from.toISOString().slice(0, 10)).toBe("2026-09-09");
    expect(to.toISOString().slice(0, 10)).toBe("2026-09-15");
  });

  it("computes a previous period of equal length immediately preceding the current one", () => {
    const { from, to, previousFrom, previousTo } = resolveDateRange("7d", null, null, NOW);
    const spanMs = to.getTime() - from.getTime();
    const previousSpanMs = previousTo.getTime() - previousFrom.getTime();
    expect(previousSpanMs).toBe(spanMs);
    expect(previousTo.getTime()).toBeLessThan(from.getTime());
  });

  it("falls back to a 30-day window when custom dates are missing", () => {
    const { from, to } = resolveDateRange("custom", null, null, NOW);
    expect(from.toISOString().slice(0, 10)).toBe("2026-08-17");
    expect(to.toISOString().slice(0, 10)).toBe("2026-09-15");
  });

  it("honors explicit custom from/to dates", () => {
    const { from, to } = resolveDateRange("custom", "2026-01-01", "2026-01-31", NOW);
    expect(from.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(to.toISOString().slice(0, 10)).toBe("2026-01-31");
  });

  it("resolves 'thisYear' starting January 1st", () => {
    const { from } = resolveDateRange("thisYear", null, null, NOW);
    expect(from.toISOString().slice(0, 10)).toBe("2026-01-01");
  });
});

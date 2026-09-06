import { describe, it, expect } from "vitest";
import { buildKpiResult } from "@/lib/reports/kpi";

describe("buildKpiResult", () => {
  it("computes a positive percent change and 'up' trend", () => {
    const kpi = buildKpiResult(120, 100);
    expect(kpi.percentChange).toBe(20);
    expect(kpi.trend).toBe("up");
  });

  it("computes a negative percent change and 'down' trend", () => {
    const kpi = buildKpiResult(80, 100);
    expect(kpi.percentChange).toBe(-20);
    expect(kpi.trend).toBe("down");
  });

  it("returns 'flat' for no change", () => {
    const kpi = buildKpiResult(100, 100);
    expect(kpi.percentChange).toBe(0);
    expect(kpi.trend).toBe("flat");
  });

  it("returns null percent change when both current and previous are zero", () => {
    const kpi = buildKpiResult(0, 0);
    expect(kpi.percentChange).toBeNull();
    expect(kpi.trend).toBeNull();
  });

  it("returns 100% when previous was zero and current is positive", () => {
    const kpi = buildKpiResult(5, 0);
    expect(kpi.percentChange).toBe(100);
    expect(kpi.trend).toBe("up");
  });
});

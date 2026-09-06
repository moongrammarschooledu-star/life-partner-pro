import { describe, it, expect } from "vitest";
import { getReportColumns, canViewSensitiveColumns, REPORT_DEFINITIONS } from "@/lib/reports/columns";

describe("canViewSensitiveColumns", () => {
  it("allows SUPER_ADMIN and ADMIN", () => {
    expect(canViewSensitiveColumns("SUPER_ADMIN")).toBe(true);
    expect(canViewSensitiveColumns("ADMIN")).toBe(true);
  });

  it("blocks STAFF and VIEWER", () => {
    expect(canViewSensitiveColumns("STAFF")).toBe(false);
    expect(canViewSensitiveColumns("VIEWER")).toBe(false);
  });
});

describe("getReportColumns", () => {
  it("returns every column, including sensitive ones, for SUPER_ADMIN", () => {
    const columns = getReportColumns("Profiles", "SUPER_ADMIN");
    expect(columns.some((c) => c.key === "mobileNumber")).toBe(true);
    expect(columns.some((c) => c.key === "monthlyIncome")).toBe(true);
  });

  it("strips every sensitive column for STAFF", () => {
    const columns = getReportColumns("Profiles", "STAFF");
    expect(columns.some((c) => c.sensitive)).toBe(false);
    expect(columns.some((c) => c.key === "profileCode")).toBe(true);
  });

  it("strips sensitive columns for VIEWER across every data source", () => {
    for (const dataSource of Object.keys(REPORT_DEFINITIONS) as (keyof typeof REPORT_DEFINITIONS)[]) {
      const columns = getReportColumns(dataSource, "VIEWER");
      expect(columns.every((c) => !c.sensitive)).toBe(true);
    }
  });
});

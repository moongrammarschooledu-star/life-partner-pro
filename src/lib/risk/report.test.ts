import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { parseRange, riskReportToCsv } = await import("./report");

const empty = {
  period: { from: "a", to: "b" }, signalsByType: {}, signalsByCategory: {}, casesOpened: 0, casesByStatus: {}, casesByLevel: {}, decisions: {},
  falsePositives: { total: 0, byReason: {}, rateOfDecided: null }, meanHoursToFirstReview: null, duplicateClustersByStatus: {},
  restrictions: { applied: 0, temporary: 0, permanent: 0, byType: {} }, technicalControls: 0, userReports: { total: 0, byType: {}, byStatus: {} }, generatedAt: "now",
};

describe("parseRange", () => {
  const now = new Date("2026-06-30T00:00:00Z");
  it("defaults to the last 30 days", () => {
    const r = parseRange(null, null, now);
    expect(Math.round((r.to.getTime() - r.from.getTime()) / 86_400_000)).toBe(30);
  });
  it("ignores unparseable dates", () => {
    const r = parseRange("not-a-date", "also-bad", now);
    expect(Math.round((r.to.getTime() - r.from.getTime()) / 86_400_000)).toBe(30);
  });
  it("caps any range at one year so a report can never become an unbounded scan", () => {
    const r = parseRange("2000-01-01", "2026-06-30", now);
    expect((r.to.getTime() - r.from.getTime()) / 86_400_000).toBeLessThanOrEqual(366);
  });
});

describe("riskReportToCsv", () => {
  it("emits a header and aggregate rows only", () => {
    const csv = riskReportToCsv({ ...empty, signalsByType: { LOGIN_ABUSE_SIGNAL: 4 }, casesOpened: 2 });
    expect(csv.split("\n")[0]).toBe("section,metric,value");
    expect(csv).toContain("signals_by_type,LOGIN_ABUSE_SIGNAL,4");
    expect(csv).toContain("summary,cases_opened,2");
  });
  it("neutralises spreadsheet formula injection in metric names", () => {
    const csv = riskReportToCsv({ ...empty, signalsByType: { "=HYPERLINK(\"x\")": 1, "+cmd": 2 } });
    expect(csv).not.toMatch(/^signals_by_type,=/m);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+cmd");
  });
  it("contains no identifiers: only section / metric / value columns", () => {
    for (const line of riskReportToCsv(empty).trim().split("\n")) expect(line.split(",").length).toBeGreaterThanOrEqual(3);
  });
});

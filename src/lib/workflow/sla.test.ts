import { describe, it, expect, vi, beforeEach } from "vitest";

let configRow: { taskType: string; targetResponseHours: number | null; targetResolutionHours: number | null; warningThresholdHours: number | null; active: boolean } | null;
vi.mock("@/lib/prisma", () => ({
  prisma: {
    taskSlaConfig: {
      findUnique: vi.fn(() => Promise.resolve(configRow)),
    },
  },
}));

import { computeTaskSlaDueDates, classifyTaskSla } from "@/lib/workflow/sla";

beforeEach(() => {
  configRow = { taskType: "VERIFICATION_REVIEW", targetResponseHours: 8, targetResolutionHours: 24, warningThresholdHours: 20, active: true };
});

describe("computeTaskSlaDueDates", () => {
  it("computes due dates from the configured hours", async () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const result = await computeTaskSlaDueDates("VERIFICATION_REVIEW", from);
    expect(result.targetResponseAt).toEqual(new Date("2026-01-01T08:00:00.000Z"));
    expect(result.targetResolutionAt).toEqual(new Date("2026-01-02T00:00:00.000Z"));
    expect(result.warningAt).toEqual(new Date("2026-01-01T20:00:00.000Z"));
  });

  it("returns all nulls when no config row exists for the task type", async () => {
    configRow = null;
    const result = await computeTaskSlaDueDates("GENERAL_ADMIN_TASK");
    expect(result).toEqual({ targetResponseAt: null, targetResolutionAt: null, warningAt: null });
  });

  it("returns all nulls when the config row is inactive", async () => {
    configRow!.active = false;
    const result = await computeTaskSlaDueDates("VERIFICATION_REVIEW");
    expect(result).toEqual({ targetResponseAt: null, targetResolutionAt: null, warningAt: null });
  });
});

describe("classifyTaskSla", () => {
  const now = new Date("2026-01-02T00:00:00.000Z");

  it("returns PAUSED regardless of due date when paused", () => {
    expect(classifyTaskSla({ targetResolutionAt: new Date(now.getTime() - 1000), warningAt: null, escalated: false, paused: true, now })).toBe("PAUSED");
  });

  it("returns ESCALATED when escalated and not paused", () => {
    expect(classifyTaskSla({ targetResolutionAt: new Date(now.getTime() - 1000), warningAt: null, escalated: true, paused: false, now })).toBe("ESCALATED");
  });

  it("returns null when there is no target resolution date (no SLA configured)", () => {
    expect(classifyTaskSla({ targetResolutionAt: null, warningAt: null, escalated: false, paused: false, now })).toBeNull();
  });

  it("returns OVERDUE once the target resolution time has passed", () => {
    expect(classifyTaskSla({ targetResolutionAt: new Date(now.getTime() - 1000), warningAt: null, escalated: false, paused: false, now })).toBe("OVERDUE");
  });

  it("returns DUE_SOON within the fixed 4-hour window", () => {
    expect(classifyTaskSla({ targetResolutionAt: new Date(now.getTime() + 3 * 60 * 60 * 1000), warningAt: null, escalated: false, paused: false, now })).toBe("DUE_SOON");
  });

  it("returns WARNING once past the warning threshold but outside the due-soon window", () => {
    expect(
      classifyTaskSla({
        targetResolutionAt: new Date(now.getTime() + 10 * 60 * 60 * 1000),
        warningAt: new Date(now.getTime() - 1000),
        escalated: false,
        paused: false,
        now,
      })
    ).toBe("WARNING");
  });

  it("returns ON_TRACK when well within the target and before the warning threshold", () => {
    expect(
      classifyTaskSla({
        targetResolutionAt: new Date(now.getTime() + 10 * 60 * 60 * 1000),
        warningAt: new Date(now.getTime() + 5 * 60 * 60 * 1000),
        escalated: false,
        paused: false,
        now,
      })
    ).toBe("ON_TRACK");
  });
});

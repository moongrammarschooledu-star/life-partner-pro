import { describe, it, expect } from "vitest";
import { classifySla } from "./case-sla";

describe("classifySla", () => {
  it("returns null when there is no due date", () => {
    expect(classifySla(null)).toBeNull();
  });

  it("returns OVERDUE once the due date has passed", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const dueAt = new Date("2026-01-01T11:00:00Z");
    expect(classifySla(dueAt, now)).toBe("OVERDUE");
  });

  it("returns DUE_SOON within the fixed 4-hour window", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const dueAt = new Date("2026-01-01T15:00:00Z"); // 3h away
    expect(classifySla(dueAt, now)).toBe("DUE_SOON");
  });

  it("treats exactly 4 hours remaining as DUE_SOON (inclusive boundary)", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const dueAt = new Date("2026-01-01T16:00:00Z"); // exactly 4h away
    expect(classifySla(dueAt, now)).toBe("DUE_SOON");
  });

  it("returns ON_TIME when comfortably before the due date", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const dueAt = new Date("2026-01-02T12:00:00Z"); // 24h away
    expect(classifySla(dueAt, now)).toBe("ON_TIME");
  });
});

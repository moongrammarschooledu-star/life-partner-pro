import { describe, it, expect } from "vitest";
import { classifyFollowupSla } from "./followup-service";

describe("classifyFollowupSla", () => {
  const now = new Date("2026-01-01T12:00:00Z");

  it("is EXEMPT once completed or cancelled, regardless of due date", () => {
    expect(classifyFollowupSla({ dueDate: new Date("2025-01-01"), status: "COMPLETED", now })).toBe("EXEMPT");
    expect(classifyFollowupSla({ dueDate: new Date("2025-01-01"), status: "CANCELLED", now })).toBe("EXEMPT");
  });

  it("is BREACHED once escalated", () => {
    expect(classifyFollowupSla({ dueDate: new Date("2026-01-05"), status: "ESCALATED", now })).toBe("BREACHED");
  });

  it("is ON_TRACK when comfortably before the due date", () => {
    expect(classifyFollowupSla({ dueDate: new Date("2026-01-03T12:00:00Z"), status: "PENDING", now })).toBe("ON_TRACK");
  });

  it("is DUE_SOON within the 4-hour window before due", () => {
    expect(classifyFollowupSla({ dueDate: new Date("2026-01-01T15:00:00Z"), status: "PENDING", now })).toBe("DUE_SOON");
  });

  it("is OVERDUE just past the due date", () => {
    expect(classifyFollowupSla({ dueDate: new Date("2026-01-01T11:00:00Z"), status: "PENDING", now })).toBe("OVERDUE");
  });

  it("is BREACHED once overdue by more than 24 hours", () => {
    expect(classifyFollowupSla({ dueDate: new Date("2025-12-31T11:00:00Z"), status: "PENDING", now })).toBe("BREACHED");
  });
});

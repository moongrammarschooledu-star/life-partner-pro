import { describe, it, expect } from "vitest";
import { isValidTransition, ALLOWED_TRANSITIONS, ACTIVE_TASK_STATUSES, TERMINAL_TASK_STATUSES } from "./status";
import type { AdminTaskStatus } from "@prisma/client";

const ALL_STATUSES: AdminTaskStatus[] = [
  "PENDING",
  "NEW",
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
  "WAITING_FOR_USER",
  "WAITING_FOR_STAFF",
  "WAITING_FOR_APPROVAL",
  "BLOCKED",
  "ESCALATED",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
  "REOPENED",
  "ARCHIVED",
];

describe("isValidTransition", () => {
  it("allows the normal happy path", () => {
    expect(isValidTransition("NEW", "ASSIGNED")).toBe(true);
    expect(isValidTransition("ASSIGNED", "ACCEPTED")).toBe(true);
    expect(isValidTransition("ACCEPTED", "IN_PROGRESS")).toBe(true);
    expect(isValidTransition("IN_PROGRESS", "COMPLETED")).toBe(true);
  });

  it("rejects skipping straight from NEW to COMPLETED", () => {
    expect(isValidTransition("NEW", "COMPLETED")).toBe(false);
  });

  it("rejects any transition out of ARCHIVED (terminal)", () => {
    for (const to of ALL_STATUSES) {
      if (to === "ARCHIVED") continue;
      expect(isValidTransition("ARCHIVED", to)).toBe(false);
    }
  });

  it("allows completed/cancelled/expired tasks to be archived or reopened", () => {
    expect(isValidTransition("COMPLETED", "ARCHIVED")).toBe(true);
    expect(isValidTransition("COMPLETED", "REOPENED")).toBe(true);
    expect(isValidTransition("CANCELLED", "REOPENED")).toBe(true);
    expect(isValidTransition("EXPIRED", "REOPENED")).toBe(true);
  });

  it("treats staying in the same status as always valid", () => {
    for (const s of ALL_STATUSES) expect(isValidTransition(s, s)).toBe(true);
  });

  it("every status has a defined (possibly empty) transition list", () => {
    for (const s of ALL_STATUSES) expect(ALLOWED_TRANSITIONS[s]).toBeDefined();
  });
});

describe("ACTIVE_TASK_STATUSES / TERMINAL_TASK_STATUSES", () => {
  it("partition all statuses with no overlap and no gaps", () => {
    const combined = new Set([...ACTIVE_TASK_STATUSES, ...TERMINAL_TASK_STATUSES]);
    expect(combined.size).toBe(ALL_STATUSES.length);
    for (const s of ALL_STATUSES) expect(combined.has(s)).toBe(true);
    for (const s of ACTIVE_TASK_STATUSES) expect(TERMINAL_TASK_STATUSES.includes(s)).toBe(false);
  });
});

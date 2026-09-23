import { describe, it, expect } from "vitest";
import { isValidTransition, ALLOWED_TRANSITIONS, ACTIVE_APPROVAL_STATUSES, TERMINAL_APPROVAL_STATUSES, DECIDABLE_APPROVAL_STATUSES } from "@/lib/approvals/status";
import type { ApprovalStatus } from "@prisma/client";

describe("approvals/status", () => {
  it("allows every status to transition to itself", () => {
    for (const status of Object.keys(ALLOWED_TRANSITIONS) as ApprovalStatus[]) {
      expect(isValidTransition(status, status)).toBe(true);
    }
  });

  it("allows the documented DRAFT -> SUBMITTED -> PENDING_APPROVAL -> APPROVED -> EXECUTION_PENDING -> EXECUTING -> EXECUTED path", () => {
    const path: ApprovalStatus[] = ["DRAFT", "SUBMITTED", "PENDING_APPROVAL", "APPROVED", "EXECUTION_PENDING", "EXECUTING", "EXECUTED"];
    for (let i = 0; i < path.length - 1; i++) {
      expect(isValidTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it("rejects skipping straight from DRAFT to APPROVED", () => {
    expect(isValidTransition("DRAFT", "APPROVED")).toBe(false);
  });

  it("rejects executing directly from PENDING_APPROVAL", () => {
    expect(isValidTransition("PENDING_APPROVAL", "EXECUTED")).toBe(false);
  });

  it("never allows a transition out of a terminal ARCHIVED status", () => {
    expect(ALLOWED_TRANSITIONS.ARCHIVED).toEqual([]);
  });

  it("REJECTED never leads to EXECUTED (rejection is final for the original action)", () => {
    expect(isValidTransition("REJECTED", "EXECUTED")).toBe(false);
    expect(isValidTransition("REJECTED", "EXECUTION_PENDING")).toBe(false);
  });

  it("EXPIRED never leads to EXECUTED", () => {
    expect(isValidTransition("EXPIRED", "EXECUTED")).toBe(false);
    expect(isValidTransition("EXPIRED", "APPROVED")).toBe(false);
  });

  it("ACTIVE/TERMINAL/DECIDABLE status lists are mutually consistent (no overlap between active and terminal)", () => {
    for (const s of ACTIVE_APPROVAL_STATUSES) expect(TERMINAL_APPROVAL_STATUSES.includes(s)).toBe(false);
    for (const s of DECIDABLE_APPROVAL_STATUSES) expect(TERMINAL_APPROVAL_STATUSES.includes(s)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { sumProposalStatuses } from "@/lib/reports/proposal-status";

describe("sumProposalStatuses", () => {
  it("sums the exact legacy+new statuses that fold into 'mutualInterest'", () => {
    const countByStatus = { BOTH_INTERESTED: 3, INTERESTED: 2, REJECTED: 1 };
    expect(sumProposalStatuses(countByStatus, "mutualInterest")).toBe(5);
  });

  it("sums both legacy and new rejection statuses", () => {
    const countByStatus = { REJECTED: 4, NOT_INTERESTED: 1 };
    expect(sumProposalStatuses(countByStatus, "rejected")).toBe(5);
  });

  it("returns 0 when no matching statuses are present", () => {
    expect(sumProposalStatuses({ FINALIZED: 2 }, "married")).toBe(0);
  });

  it("treats missing status keys as zero rather than throwing", () => {
    expect(sumProposalStatuses({}, "pendingResponses")).toBe(0);
  });
});

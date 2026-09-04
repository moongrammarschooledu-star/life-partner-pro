import { describe, it, expect } from "vitest";
import { nextProposalStatus, deriveApplicantHighlights } from "./proposal-workflow";
import type { CategoryResult } from "./matching";

function category(overrides: Partial<CategoryResult>): CategoryResult {
  return {
    category: "age",
    label: "Age Compatibility",
    weight: 15,
    score: 1,
    points: 15,
    status: "compatible",
    reason: "Internal admin reason text that must never reach an applicant.",
    isDifference: false,
    hardRequirementFailed: false,
    ...overrides,
  };
}

describe("nextProposalStatus", () => {
  it("leaves the status untouched when neither side has responded", () => {
    expect(nextProposalStatus("PROPOSAL_CREATED", null, null)).toBe("PROPOSAL_CREATED");
  });

  it("moves to WAITING_FOR_PROFILE_B when only A is interested", () => {
    expect(nextProposalStatus("PROPOSAL_CREATED", "INTERESTED", null)).toBe("WAITING_FOR_PROFILE_B");
  });

  it("moves to WAITING_FOR_PROFILE_A when only B is interested", () => {
    expect(nextProposalStatus("PROPOSAL_CREATED", null, "INTERESTED")).toBe("WAITING_FOR_PROFILE_A");
  });

  it("reaches BOTH_INTERESTED once both sides say interested, regardless of order", () => {
    expect(nextProposalStatus("WAITING_FOR_PROFILE_B", "INTERESTED", "INTERESTED")).toBe("BOTH_INTERESTED");
  });

  it("ends the proposal at REJECTED the moment either side is not interested", () => {
    expect(nextProposalStatus("BOTH_REVIEWING", "NOT_INTERESTED", "INTERESTED")).toBe("REJECTED");
    expect(nextProposalStatus("BOTH_REVIEWING", "INTERESTED", "NOT_INTERESTED")).toBe("REJECTED");
  });

  it("keeps a need-more-info response in a reviewing state rather than rejecting or confirming", () => {
    expect(nextProposalStatus("PROPOSAL_CREATED", "NEED_MORE_INFO", null)).toBe("BOTH_REVIEWING");
    expect(nextProposalStatus("PROPOSAL_CREATED", "INTERESTED", "NEED_MORE_INFO")).toBe("PROFILE_A_INTERESTED");
    expect(nextProposalStatus("PROPOSAL_CREATED", "NEED_MORE_INFO", "INTERESTED")).toBe("PROFILE_B_INTERESTED");
  });
});

describe("deriveApplicantHighlights", () => {
  it("never leaks the raw admin reason text", () => {
    const { highlights, differences } = deriveApplicantHighlights([
      category({ category: "age", status: "compatible", reason: "Ages 29 vs 31 — internal note" }),
      category({ category: "location", status: "incompatible", reason: "Cities 400km apart — internal note", isDifference: true }),
    ]);
    const allText = [...highlights, ...differences].join(" ");
    expect(allText).not.toContain("internal note");
    expect(allText).not.toContain("29");
    expect(allText).not.toContain("400km");
  });

  it("sorts compatible categories as highlights and incompatible/partial ones as differences", () => {
    const { highlights, differences } = deriveApplicantHighlights([
      category({ category: "age", status: "compatible" }),
      category({ category: "location", status: "partial", isDifference: true }),
      category({ category: "religious", status: "unknown" }),
    ]);
    expect(highlights).toHaveLength(1);
    expect(differences).toHaveLength(1);
  });
});

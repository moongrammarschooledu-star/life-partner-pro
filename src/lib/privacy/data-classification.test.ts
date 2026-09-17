import { describe, it, expect } from "vitest";
import { classify, DATA_CLASSIFICATION } from "./data-classification";

describe("classify", () => {
  it("classifies public fields as PUBLIC", () => {
    expect(classify("profileId")).toBe("PUBLIC");
    expect(classify("profileCode")).toBe("PUBLIC");
  });

  it("classifies contact fields as HIGHLY_SENSITIVE", () => {
    expect(classify("mobileNumber")).toBe("HIGHLY_SENSITIVE");
    expect(classify("email")).toBe("HIGHLY_SENSITIVE");
    expect(classify("monthlyIncome")).toBe("HIGHLY_SENSITIVE");
  });

  it("classifies education/family fields as CONFIDENTIAL", () => {
    expect(classify("education")).toBe("CONFIDENTIAL");
    expect(classify("familyBackground")).toBe("CONFIDENTIAL");
  });

  it("classifies restricted investigation records as RESTRICTED", () => {
    expect(classify("securityInvestigation")).toBe("RESTRICTED");
    expect(classify("staffConductCase")).toBe("RESTRICTED");
  });

  it("defaults an unknown field to CONFIDENTIAL rather than leaking as PUBLIC", () => {
    expect(classify("someBrandNewFieldNobodyClassifiedYet")).toBe("CONFIDENTIAL");
  });

  it("every entry in the table is one of the five valid tiers", () => {
    const valid = new Set(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "HIGHLY_SENSITIVE", "RESTRICTED"]);
    for (const tier of Object.values(DATA_CLASSIFICATION)) {
      expect(valid.has(tier)).toBe(true);
    }
  });
});

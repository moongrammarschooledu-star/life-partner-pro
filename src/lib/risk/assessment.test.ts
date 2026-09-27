import { describe, it, expect } from "vitest";
import { deriveRiskBand } from "./assessment";

describe("deriveRiskBand", () => {
  it("is LOW with nothing open and high confidence", () => {
    const result = deriveRiskBand({ openFlagSeverities: [], openDuplicateReviewCount: 0, verificationConfidence: "HIGH" });
    expect(result.band).toBe("LOW");
    expect(result.explanation).toEqual(["No open risk signals or reviews."]);
  });

  it("is CRITICAL whenever any open flag is CRITICAL, regardless of anything else", () => {
    const result = deriveRiskBand({ openFlagSeverities: ["LOW", "CRITICAL"], openDuplicateReviewCount: 0, verificationConfidence: "HIGH" });
    expect(result.band).toBe("CRITICAL");
    expect(result.explanation.some((e) => e.includes("critical-severity"))).toBe(true);
  });

  it("is HIGH with an open HIGH flag", () => {
    const result = deriveRiskBand({ openFlagSeverities: ["HIGH"], openDuplicateReviewCount: 0, verificationConfidence: "HIGH" });
    expect(result.band).toBe("HIGH");
  });

  it("is HIGH with 2+ open duplicate reviews even with no flags", () => {
    const result = deriveRiskBand({ openFlagSeverities: [], openDuplicateReviewCount: 2, verificationConfidence: "HIGH" });
    expect(result.band).toBe("HIGH");
  });

  it("is MEDIUM with a single open duplicate review", () => {
    const result = deriveRiskBand({ openFlagSeverities: [], openDuplicateReviewCount: 1, verificationConfidence: "HIGH" });
    expect(result.band).toBe("MEDIUM");
  });

  it("is MEDIUM with any open MEDIUM flag", () => {
    const result = deriveRiskBand({ openFlagSeverities: ["MEDIUM"], openDuplicateReviewCount: 0, verificationConfidence: "HIGH" });
    expect(result.band).toBe("MEDIUM");
  });

  it("is MEDIUM when verification confidence alone is LOW", () => {
    const result = deriveRiskBand({ openFlagSeverities: [], openDuplicateReviewCount: 0, verificationConfidence: "LOW" });
    expect(result.band).toBe("MEDIUM");
  });

  it("a LOW-severity flag alone does not push the band above LOW", () => {
    const result = deriveRiskBand({ openFlagSeverities: ["LOW"], openDuplicateReviewCount: 0, verificationConfidence: "HIGH" });
    expect(result.band).toBe("LOW");
    expect(result.explanation.some((e) => e.includes("low-severity"))).toBe(true);
  });

  it("never produces accusatory language — only neutral review-required phrasing", () => {
    const result = deriveRiskBand({ openFlagSeverities: ["CRITICAL", "HIGH", "MEDIUM"], openDuplicateReviewCount: 3, verificationConfidence: "LOW" });
    const text = result.explanation.join(" ").toLowerCase();
    for (const forbidden of ["fraud", "scammer", "fake", "criminal", "dishonest", "liar"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

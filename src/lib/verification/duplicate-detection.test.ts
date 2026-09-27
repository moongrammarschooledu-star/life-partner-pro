import { describe, it, expect } from "vitest";
import { findDuplicateSignals, computeDuplicateConfidence, type DuplicateCandidateProfile } from "./duplicate-detection";

function profile(overrides: Partial<DuplicateCandidateProfile>): DuplicateCandidateProfile {
  return {
    id: "p1",
    fullName: "Ayesha Khan",
    dateOfBirth: "1995-06-15T00:00:00.000Z",
    mobileNumber: "+923001234567",
    email: "ayesha@example.com",
    ...overrides,
  };
}

describe("findDuplicateSignals", () => {
  it("returns no matches when nothing overlaps", () => {
    const target = profile({ id: "target" });
    const candidates = [profile({ id: "other", fullName: "Someone Else", mobileNumber: "+923009999999", email: "other@example.com", dateOfBirth: "1990-01-01T00:00:00.000Z" })];
    expect(findDuplicateSignals(target, candidates)).toHaveLength(0);
  });

  it("flags a shared mobile number regardless of formatting differences", () => {
    const target = profile({ id: "target", mobileNumber: "+92 300 1234567" });
    const candidates = [profile({ id: "other", fullName: "Different Name", email: "different@example.com", mobileNumber: "+92-300-1234567" })];
    const matches = findDuplicateSignals(target, candidates);
    expect(matches).toHaveLength(1);
    expect(matches[0].signals).toContain("MOBILE");
  });

  it("flags a shared email case-insensitively", () => {
    const target = profile({ id: "target", email: "Ayesha@Example.com" });
    const candidates = [profile({ id: "other", fullName: "Different Name", mobileNumber: "+923009999999", email: "ayesha@example.com" })];
    const matches = findDuplicateSignals(target, candidates);
    expect(matches[0].signals).toEqual(["EMAIL"]);
  });

  it("flags matching name + date of birth as a distinct signal", () => {
    const target = profile({ id: "target" });
    const candidates = [profile({ id: "other", mobileNumber: "+923009999999", email: "other@example.com" })];
    const matches = findDuplicateSignals(target, candidates);
    expect(matches[0].signals).toEqual(["NAME_AND_DOB"]);
  });

  it("never matches a profile against itself", () => {
    const target = profile({ id: "same" });
    expect(findDuplicateSignals(target, [profile({ id: "same" })])).toHaveLength(0);
  });

  it("can report multiple signals for the same candidate", () => {
    const target = profile({ id: "target" });
    const candidates = [profile({ id: "other" })]; // identical mobile, email, name+dob
    const matches = findDuplicateSignals(target, candidates);
    expect(matches[0].signals.sort()).toEqual(["EMAIL", "MOBILE", "NAME_AND_DOB"]);
  });
});

describe("computeDuplicateConfidence", () => {
  it("a single MOBILE or EMAIL signal alone lands in MEDIUM, not STRONG", () => {
    expect(computeDuplicateConfidence(["MOBILE"])).toEqual({ score: 35, band: "MEDIUM" });
    expect(computeDuplicateConfidence(["EMAIL"])).toEqual({ score: 35, band: "MEDIUM" });
  });

  it("MOBILE + EMAIL together reach STRONG", () => {
    expect(computeDuplicateConfidence(["MOBILE", "EMAIL"])).toEqual({ score: 70, band: "STRONG" });
  });

  it("NAME_AND_DOB alone is MEDIUM", () => {
    expect(computeDuplicateConfidence(["NAME_AND_DOB"])).toEqual({ score: 30, band: "MEDIUM" });
  });

  it("all three signals cap at 100, not 100+", () => {
    expect(computeDuplicateConfidence(["MOBILE", "EMAIL", "NAME_AND_DOB"])).toEqual({ score: 100, band: "STRONG" });
  });

  it("no signals is LOW with a score of 0", () => {
    expect(computeDuplicateConfidence([])).toEqual({ score: 0, band: "LOW" });
  });
});

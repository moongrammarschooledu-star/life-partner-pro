import { describe, it, expect } from "vitest";
import { findDuplicateSignals, type DuplicateCandidateProfile } from "./duplicate-detection";

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

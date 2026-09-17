import { describe, it, expect } from "vitest";
import { isRecordEligibleForAction } from "./retention-policy";

describe("isRecordEligibleForAction", () => {
  it("returns false when there is no policy", () => {
    expect(isRecordEligibleForAction(1000, null)).toBe(false);
  });

  it("returns false when the policy is disabled", () => {
    expect(isRecordEligibleForAction(1000, { retentionDays: 30, isActive: false })).toBe(false);
  });

  it("returns false when retentionDays is zero or negative (treated as unconfigured)", () => {
    expect(isRecordEligibleForAction(1000, { retentionDays: 0, isActive: true })).toBe(false);
    expect(isRecordEligibleForAction(1000, { retentionDays: -5, isActive: true })).toBe(false);
  });

  it("returns false when the record is younger than the retention period", () => {
    expect(isRecordEligibleForAction(10, { retentionDays: 30, isActive: true })).toBe(false);
  });

  it("returns true once the record reaches exactly the retention period (inclusive boundary)", () => {
    expect(isRecordEligibleForAction(30, { retentionDays: 30, isActive: true })).toBe(true);
  });

  it("returns true when the record is older than the retention period", () => {
    expect(isRecordEligibleForAction(365, { retentionDays: 30, isActive: true })).toBe(true);
  });
});

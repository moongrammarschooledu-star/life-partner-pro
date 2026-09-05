import { describe, it, expect } from "vitest";
import { isQuietHours, checkDailyLimit } from "@/lib/notifications/anti-spam";

describe("isQuietHours", () => {
  it("returns false when unset", () => {
    expect(isQuietHours(23, null, null)).toBe(false);
  });

  it("handles a non-wrapping window", () => {
    expect(isQuietHours(10, 9, 17)).toBe(true);
    expect(isQuietHours(8, 9, 17)).toBe(false);
    expect(isQuietHours(17, 9, 17)).toBe(false); // end is exclusive
  });

  it("handles a window that wraps past midnight", () => {
    expect(isQuietHours(22, 21, 8)).toBe(true);
    expect(isQuietHours(3, 21, 8)).toBe(true);
    expect(isQuietHours(12, 21, 8)).toBe(false);
  });

  it("treats an equal start/end as no quiet window", () => {
    expect(isQuietHours(5, 9, 9)).toBe(false);
  });
});

describe("checkDailyLimit", () => {
  it("allows sends up to the limit and blocks the next one", () => {
    const profileId = `test-profile-${Date.now()}-${Math.random()}`;
    expect(checkDailyLimit(profileId, "EMAIL", 2)).toBe(true);
    expect(checkDailyLimit(profileId, "EMAIL", 2)).toBe(true);
    expect(checkDailyLimit(profileId, "EMAIL", 2)).toBe(false);
  });

  it("tracks channels independently", () => {
    const profileId = `test-profile-${Date.now()}-${Math.random()}`;
    expect(checkDailyLimit(profileId, "EMAIL", 1)).toBe(true);
    expect(checkDailyLimit(profileId, "SMS", 1)).toBe(true);
  });
});

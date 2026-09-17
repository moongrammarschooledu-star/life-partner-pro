import { describe, it, expect } from "vitest";
import { resolveAccountStatus } from "./account-status";

function profile(overrides: Partial<Parameters<typeof resolveAccountStatus>[0]> = {}) {
  return {
    accountStatus: "ACTIVE" as const,
    status: "ACTIVE" as const,
    softDeleted: false,
    verified: true,
    ...overrides,
  };
}

describe("resolveAccountStatus", () => {
  it("takes accountStatus terminal states as authoritative regardless of profile status", () => {
    expect(resolveAccountStatus(profile({ accountStatus: "DELETED" }), false)).toBe("DELETED");
    expect(resolveAccountStatus(profile({ accountStatus: "DELETION_PROCESSING" }), false)).toBe("DELETION_PROCESSING");
    expect(resolveAccountStatus(profile({ accountStatus: "DELETION_REQUESTED" }), false)).toBe("DELETION_REQUESTED");
    expect(resolveAccountStatus(profile({ accountStatus: "DEACTIVATED" }), false)).toBe("DEACTIVATED");
  });

  it("treats softDeleted or ARCHIVED status as ARCHIVED", () => {
    expect(resolveAccountStatus(profile({ softDeleted: true }), false)).toBe("ARCHIVED");
    expect(resolveAccountStatus(profile({ status: "ARCHIVED" as never }), false)).toBe("ARCHIVED");
  });

  it("surfaces SUSPENDED from the existing ProfileStatus lifecycle", () => {
    expect(resolveAccountStatus(profile({ status: "SUSPENDED" as never }), false)).toBe("SUSPENDED");
  });

  it("reports RESTRICTED when there are active restrictions, even if profile status is otherwise ACTIVE", () => {
    expect(resolveAccountStatus(profile(), true)).toBe("RESTRICTED");
  });

  it("reports PENDING_VERIFICATION for a brand-new, unverified profile", () => {
    expect(resolveAccountStatus(profile({ status: "NEW" as never, verified: false }), false)).toBe("PENDING_VERIFICATION");
  });

  it("falls through to ACTIVE for a normal, active, verified profile with no restrictions", () => {
    expect(resolveAccountStatus(profile(), false)).toBe("ACTIVE");
  });

  it("prioritizes accountStatus over active restrictions", () => {
    expect(resolveAccountStatus(profile({ accountStatus: "DEACTIVATED" }), true)).toBe("DEACTIVATED");
  });
});

import { describe, it, expect } from "vitest";
import { buildActionUrl } from "@/lib/notifications/deep-link";

describe("buildActionUrl", () => {
  it("routes proposal-family types to /my-proposals for a profile recipient", () => {
    expect(buildActionUrl("PROFILE", "PROPOSAL_RECEIVED", {})).toBe("/my-proposals");
    expect(buildActionUrl("PROFILE", "MEETING_SCHEDULED", {})).toBe("/my-proposals");
    expect(buildActionUrl("PROFILE", "CONTACT_PERMISSION_APPROVED", {})).toBe("/my-proposals");
  });

  it("routes verification types to /my-verification for a profile recipient", () => {
    expect(buildActionUrl("PROFILE", "VERIFICATION_APPROVED", {})).toBe("/my-verification");
    expect(buildActionUrl("PROFILE", "RE_VERIFICATION_REQUIRED", {})).toBe("/my-verification");
  });

  it("falls back to /my-notifications for an unmapped profile type", () => {
    expect(buildActionUrl("PROFILE", "ACCOUNT_REGISTERED", {})).toBe("/my-notifications");
  });

  it("routes admin proposal-related types to the proposal detail page when a proposalId is given", () => {
    expect(buildActionUrl("ADMIN", "ADMIN_MUTUAL_INTEREST", { proposalId: "p1" })).toBe("/admin/proposals/p1");
  });

  it("returns undefined for an admin type with no linking id available", () => {
    expect(buildActionUrl("ADMIN", "ADMIN_MUTUAL_INTEREST", {})).toBeUndefined();
  });

  it("routes duplicate/suspicious admin alerts to security flags", () => {
    expect(buildActionUrl("ADMIN", "ADMIN_DUPLICATE_PROFILE_ALERT", {})).toBe("/admin/security-flags");
  });
});

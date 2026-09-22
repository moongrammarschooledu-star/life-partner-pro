import { describe, it, expect, vi, beforeEach } from "vitest";

const privacyLogs: Array<{ action: string; targetProfileId?: string | null; reason?: string | null }> = [];
vi.mock("@/lib/privacy/access-log", () => ({
  logPrivacyAccess: async (p: { action: string; targetProfileId?: string | null; reason?: string | null }) => {
    privacyLogs.push(p);
  },
}));

let breakGlassActive = false;
vi.mock("@/lib/privacy/break-glass", () => ({
  hasActiveBreakGlass: async () => breakGlassActive,
}));

let consentByProfile: Record<string, Record<string, string>> = {};
let contactPermissions: Array<{ proposalId: string; profileId: string; approvedAt: Date | null; revokedAt: Date | null }> = [];
vi.mock("@/lib/privacy/consent", () => ({
  resolveEffectiveConsent: async (profileId: string) => consentByProfile[profileId] ?? {},
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contactPermission: {
      findMany: async ({ where }: { where: { proposalId: string } }) => contactPermissions.filter((p) => p.proposalId === where.proposalId),
    },
  },
}));

import { assertContactShareAllowed, resolveAdHocContactAccessLevel, ContactShareDeniedError } from "@/lib/privacy/contact-access";

beforeEach(() => {
  privacyLogs.length = 0;
  breakGlassActive = false;
  consentByProfile = {};
  contactPermissions = [];
});

const admin = (permissions: string[] = []) => ({ id: "admin-1", permissions: permissions as never });

describe("resolveAdHocContactAccessLevel", () => {
  it("allows an admin with contact:reveal", () => {
    expect(resolveAdHocContactAccessLevel(admin(["contact:reveal"]))).toBe("ADMIN_ONLY");
  });
  it("allows an admin with only sensitive:contact:view (e.g. VERIFICATION_MANAGER, who lacks contact:reveal by design)", () => {
    expect(resolveAdHocContactAccessLevel(admin(["sensitive:contact:view"]))).toBe("ADMIN_ONLY");
  });
  it("hides contact info from an admin with neither permission", () => {
    expect(resolveAdHocContactAccessLevel(admin([]))).toBe("HIDDEN");
  });
});

// STEP 17 §18 — the full gate order: an explicit CONTACT_SHARING consent
// revocation is a hard stop that overrides even an approved proposal, and
// every denial is written to the privacy access log, not just successes.
describe("assertContactShareAllowed (9-step gate order)", () => {
  it("blocks sharing when either profile has revoked CONTACT_SHARING consent, even with an approved proposal", async () => {
    consentByProfile["p2"] = { CONTACT_SHARING: "REVOKED" };
    contactPermissions = [
      { proposalId: "prop-1", profileId: "p1", approvedAt: new Date(), revokedAt: null },
      { proposalId: "prop-1", profileId: "p2", approvedAt: new Date(), revokedAt: null },
    ];
    await expect(
      assertContactShareAllowed({ admin: admin(["contact:reveal"]), proposalId: "prop-1", profileAId: "p1", profileBId: "p2" })
    ).rejects.toBeInstanceOf(ContactShareDeniedError);
    expect(privacyLogs).toMatchObject([{ action: "CONTACT_SHARE_DENIED", targetProfileId: "p1", reason: "One of these profiles has revoked contact-sharing consent." }]);
  });

  it("allows an approved proposal when neither profile has revoked consent", async () => {
    contactPermissions = [
      { proposalId: "prop-1", profileId: "p1", approvedAt: new Date(), revokedAt: null },
      { proposalId: "prop-1", profileId: "p2", approvedAt: new Date(), revokedAt: null },
    ];
    const result = await assertContactShareAllowed({ admin: admin([]), proposalId: "prop-1", profileAId: "p1", profileBId: "p2" });
    expect(result.level).toBe("PROPOSAL_APPROVED");
    expect(privacyLogs).toEqual([]);
  });

  it("falls back to the override permission when there is no approved proposal", async () => {
    const result = await assertContactShareAllowed({ admin: admin(["contact:reveal:override"]), profileAId: "p1", profileBId: "p2" });
    expect(result.level).toBe("FAMILY_CONTACT_APPROVED");
  });

  it("falls back to break-glass when neither a proposal nor an override applies", async () => {
    breakGlassActive = true;
    const result = await assertContactShareAllowed({ admin: admin([]), profileAId: "p1", profileBId: "p2" });
    expect(result.level).toBe("USER_APPROVED");
  });

  it("denies and logs when no path (proposal, override, break-glass) applies", async () => {
    await expect(assertContactShareAllowed({ admin: admin([]), profileAId: "p1", profileBId: "p2" })).rejects.toBeInstanceOf(ContactShareDeniedError);
    expect(privacyLogs).toHaveLength(1);
    expect(privacyLogs[0].action).toBe("CONTACT_SHARE_DENIED");
  });
});

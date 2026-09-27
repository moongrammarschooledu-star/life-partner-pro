import { describe, it, expect, vi, beforeEach } from "vitest";

let cookieValues: Record<string, string | undefined>;
let member: { status: string; familyAccount: { applicantId: string } } | null;
let restricted: boolean;

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => (cookieValues[name] ? { value: cookieValues[name] } : undefined) })),
}));
vi.mock("@/lib/family/family-session", () => ({
  verifyFamilySessionIdToken: vi.fn((token: string | undefined) => (token === "valid-session" ? "sess1" : null)),
  FAMILY_SESSION_ID_COOKIE: "lpp_fam_sid",
}));
vi.mock("@/lib/family/family-member-session", () => ({ touchAndValidateFamilyMemberSession: vi.fn(async () => "fm1") }));
vi.mock("@/lib/profile-restrictions", () => ({ hasActiveRestriction: vi.fn(async () => restricted) }));
vi.mock("@/lib/prisma", () => ({ prisma: { familyMember: { findUnique: vi.fn(async () => member) } } }));

const { requireFamilyMemberId } = await import("./require-family-member");

beforeEach(() => {
  cookieValues = { lpp_fam_sid: "valid-session" };
  member = { status: "ACTIVE", familyAccount: { applicantId: "app1" } };
  restricted = false;
});

describe("requireFamilyMemberId", () => {
  it("returns the familyMemberId for a valid, active, unrestricted member", async () => {
    expect(await requireFamilyMemberId()).toBe("fm1");
  });

  it("returns null with no session cookie", async () => {
    cookieValues = {};
    expect(await requireFamilyMemberId()).toBeNull();
  });

  it("returns null for a non-ACTIVE member", async () => {
    member = { status: "SUSPENDED", familyAccount: { applicantId: "app1" } };
    expect(await requireFamilyMemberId()).toBeNull();
  });

  it("returns null when the linked applicant profile has an active LOGIN_RESTRICTED restriction", async () => {
    restricted = true;
    expect(await requireFamilyMemberId()).toBeNull();
  });
});

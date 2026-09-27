import { describe, it, expect, vi, beforeEach } from "vitest";

let cookieValues: Record<string, string | undefined>;
let profile: { id: string; softDeleted: boolean } | null;
let restricted: boolean;

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => (cookieValues[name] ? { value: cookieValues[name] } : undefined) })),
}));
vi.mock("@/lib/applicant-session", () => ({
  verifyProfileToken: vi.fn((token: string | undefined) => (token === "valid-token" ? "p1" : null)),
  verifySessionIdToken: vi.fn((token: string | undefined) => (token === "valid-session" ? "sess1" : null)),
  APPLICANT_COOKIE: "lpp_session",
  APPLICANT_SESSION_ID_COOKIE: "lpp_sid",
}));
vi.mock("@/lib/profile-session", () => ({ touchAndValidateSession: vi.fn(async () => true) }));
vi.mock("@/lib/profile-restrictions", () => ({ hasActiveRestriction: vi.fn(async () => restricted) }));
vi.mock("@/lib/prisma", () => ({ prisma: { profile: { findUnique: vi.fn(async () => profile) } } }));

const { requireApplicantProfileId } = await import("./require-applicant");

beforeEach(() => {
  cookieValues = { lpp_session: "valid-token", lpp_sid: "valid-session" };
  profile = { id: "p1", softDeleted: false };
  restricted = false;
});

describe("requireApplicantProfileId", () => {
  it("returns the profileId for a valid, unrestricted session", async () => {
    expect(await requireApplicantProfileId()).toBe("p1");
  });

  it("returns null when no cookie is present", async () => {
    cookieValues = {};
    expect(await requireApplicantProfileId()).toBeNull();
  });

  it("returns null for a soft-deleted profile", async () => {
    profile = { id: "p1", softDeleted: true };
    expect(await requireApplicantProfileId()).toBeNull();
  });

  it("returns null when the profile has an active LOGIN_RESTRICTED restriction", async () => {
    restricted = true;
    expect(await requireApplicantProfileId()).toBeNull();
  });
});

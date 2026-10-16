import { describe, it, expect, vi, beforeEach } from "vitest";

// Verifying a profile moves it on from NEW, so a checked profile can be told apart from a new arrival.

const profileRow = { current: { status: "NEW", softDeleted: false } as { status: string; softDeleted: boolean } | null };
const consentRow = { current: { privacyConsent: true, matchmakingConsent: true, termsAccepted: true } as Record<string, boolean> | null };
const updates: Array<Record<string, unknown>> = [];
const audits: Array<Record<string, unknown>> = [];
const engagement: Array<[string, string]> = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    profile: {
      findUnique: async () => (profileRow.current ? { ...profileRow.current } : null),
      update: async ({ data }: { data: Record<string, unknown> }) => void updates.push(data),
    },
    consentRecord: { findUnique: async () => consentRow.current },
  },
}));
vi.mock("@/lib/audit", () => ({ writeAudit: async (a: Record<string, unknown>) => void audits.push(a) }));
vi.mock("@/lib/engagement/lifecycle-hooks", () => ({
  engagementOnProfileStatus: async (id: string, s: string) => void engagement.push([id, s]),
  engagementOnVerification: async () => undefined,
  engagementOnCompleteness: async () => undefined,
}));
vi.mock("@/lib/notifications/events", () => ({ notifyProfileVerificationChanged: async () => undefined, notifyProfileSuspended: async () => undefined }));
vi.mock("@/lib/crm/profile-status-sync", () => ({ syncCrmStageOnVerification: async () => undefined, syncCrmStageFromProfileStatus: async () => undefined }));

const { moveOnAfterVerification } = await import("./status");

beforeEach(() => {
  profileRow.current = { status: "NEW", softDeleted: false };
  consentRow.current = { privacyConsent: true, matchmakingConsent: true, termsAccepted: true };
  updates.length = 0;
  audits.length = 0;
  engagement.length = 0;
});

describe("a newly verified profile moves on from NEW", () => {
  it("becomes ACTIVE when the three required consents are recorded", async () => {
    await moveOnAfterVerification("p1");
    expect(updates).toEqual([{ status: "ACTIVE" }]);
    expect(audits[0]).toMatchObject({ action: "PROFILE_STATUS_CHANGED", targetProfileId: "p1", meta: { status: "ACTIVE", reason: "verification approved" } });
    expect(engagement).toEqual([["p1", "ACTIVE"]]);
  });

  it("an UNDER_REVIEW or VERIFIED profile becomes ACTIVE too", async () => {
    for (const status of ["UNDER_REVIEW", "VERIFIED"]) {
      updates.length = 0;
      profileRow.current = { status, softDeleted: false };
      await moveOnAfterVerification("p1");
      expect(updates, status).toEqual([{ status: "ACTIVE" }]);
    }
  });

  it("becomes VERIFIED, not ACTIVE, without the required consents (the manual rule is not bypassed)", async () => {
    consentRow.current = { privacyConsent: true, matchmakingConsent: false, termsAccepted: true };
    await moveOnAfterVerification("p1");
    expect(updates).toEqual([{ status: "VERIFIED" }]);
    consentRow.current = null;
    updates.length = 0;
    await moveOnAfterVerification("p1");
    expect(updates).toEqual([{ status: "VERIFIED" }]);
  });

  it("does nothing when nothing would change", async () => {
    profileRow.current = { status: "VERIFIED", softDeleted: false };
    consentRow.current = null;
    await moveOnAfterVerification("p1");
    expect(updates).toHaveLength(0);
  });

  it("never touches a profile that is further along, rejected, archived, suspended or deleted", async () => {
    for (const status of ["MATCHING", "PROPOSAL_SENT", "MEETING_ARRANGED", "FINALIZED", "MARRIED", "REJECTED", "ARCHIVED", "SUSPENDED", "ACTIVE"]) {
      profileRow.current = { status, softDeleted: false };
      await moveOnAfterVerification("p1");
    }
    profileRow.current = { status: "NEW", softDeleted: true };
    await moveOnAfterVerification("p1");
    profileRow.current = null;
    await moveOnAfterVerification("p1");
    expect(updates).toHaveLength(0);
  });

  it("never throws, so the verification that was just recorded is not undone", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    profileRow.current = { status: "NEW", softDeleted: false };
    const original = consentRow.current;
    consentRow.current = new Proxy({}, { get() { throw new Error("db down"); } }) as unknown as Record<string, boolean>;
    await expect(moveOnAfterVerification("p1")).resolves.toBeUndefined();
    consentRow.current = original;
  });
});

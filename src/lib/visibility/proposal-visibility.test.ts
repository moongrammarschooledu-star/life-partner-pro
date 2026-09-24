import { describe, it, expect, vi } from "vitest";

// ---------- fixtures (in-memory fake DB) ----------

function profile(overrides: Record<string, unknown> = {}) {
  return {
    fullName: "Ayesha Khan",
    profileCode: "LPP-000002",
    dateOfBirth: new Date("1998-05-01"),
    city: "Lahore",
    country: "Pakistan",
    maritalStatus: "NEVER_MARRIED",
    education: { level: "Masters" },
    profession: { profession: "Software Engineer" },
    family: { familyType: "NUCLEAR" },
    ...overrides,
  };
}

function breakdown() {
  return JSON.stringify([
    { category: "age", status: "compatible" },
    { category: "location", status: "partial" },
  ]);
}

function makeProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "prop1",
    proposalCode: "LPP-RP-000001",
    profileAId: "me",
    profileBId: "other",
    profileA: profile({ profileCode: "LPP-000001", fullName: "Me" }),
    profileB: profile(),
    matchScore: 82,
    status: "BOTH_INTERESTED" as const,
    createdAt: new Date("2026-01-01"),
    match: { breakdown: breakdown() },
    responses: [],
    events: [],
    contactPermissions: [],
    meetings: [],
    ...overrides,
  };
}

let proposals: ReturnType<typeof makeProposal>[];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appSettings: { findUnique: vi.fn(async () => null) },
    proposal: {
      findMany: vi.fn(async ({ where }: { where: { OR: { profileAId?: string; profileBId?: string }[] } }) => {
        const ids = where.OR.map((c) => c.profileAId ?? c.profileBId);
        return proposals.filter((p) => ids.includes(p.profileAId) || ids.includes(p.profileBId));
      }),
      findUnique: vi.fn(async ({ where }: { where: { proposalCode: string } }) => proposals.find((p) => p.proposalCode === where.proposalCode) ?? null),
      update: vi.fn(async () => {
        throw new Error("proposalCode backfill should not be needed in this fixture (proposalCode already set)");
      }),
    },
  },
}));

const { buildProposalListForProfile, buildProposalDetailForProfile, projectOtherParty, projectMeetingSummary } = await import("./proposal-visibility");

describe("ProposalVisibilityService — narrow projection", () => {
  it("never includes contact info, admin notes, staff identity, or raw scores in the list view", async () => {
    proposals = [makeProposal()];
    const items = await buildProposalListForProfile("me");
    const json = JSON.stringify(items);
    for (const forbidden of ["mobileNumber", "email", "whatsapp", "adminNote", "internalRejectionNote", "rejectionReason", "assignedTo", "createdById"]) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("projects only the frozen field set for the other party", () => {
    const view = projectOtherParty(profile() as never);
    expect(Object.keys(view).sort()).toEqual(
      ["age", "city", "country", "education", "familyType", "fullName", "maritalStatus", "profession", "profileCode"].sort()
    );
  });

  it("excludes Meeting.notes from the projected summary", () => {
    const summary = projectMeetingSummary({ id: "m1", meetingType: "FAMILY_MEETING", scheduledAt: new Date(), locationInfo: "Cafe", participants: "Both families", status: "SCHEDULED" } as never);
    expect(summary).not.toHaveProperty("notes");
  });
});

describe("buildProposalListForProfile", () => {
  it("returns the other profile from either side of the proposal, with highlights/differences derived from the breakdown", async () => {
    proposals = [makeProposal()];
    const items = await buildProposalListForProfile("me");
    expect(items).toHaveLength(1);
    expect(items[0].otherProfile.fullName).toBe("Ayesha Khan");
    expect(items[0].highlights).toContain("Ages are well matched.");
    expect(items[0].differences).toContain("Locations are farther apart than preferred.");
  });

  it("only returns proposals the profile is actually part of", async () => {
    proposals = [makeProposal({ id: "p2", proposalCode: "LPP-RP-000002", profileAId: "someoneElse", profileBId: "another" })];
    const items = await buildProposalListForProfile("me");
    expect(items).toHaveLength(0);
  });
});

describe("buildProposalDetailForProfile — IDOR/ownership", () => {
  it("returns null for a nonexistent proposal code", async () => {
    proposals = [];
    expect(await buildProposalDetailForProfile("me", "LPP-RP-999999")).toBeNull();
  });

  it("returns null (identically to not-found) for a proposal that exists but doesn't involve this profile", async () => {
    proposals = [makeProposal({ profileAId: "someoneElse", profileBId: "another" })];
    expect(await buildProposalDetailForProfile("me", "LPP-RP-000001")).toBeNull();
  });

  it("returns contact-permission booleans without exposing the other party's raw ContactPermission row", async () => {
    proposals = [
      makeProposal({
        contactPermissions: [
          { profileId: "me", approvedAt: new Date(), revokedAt: null },
          { profileId: "other", approvedAt: null, revokedAt: null },
        ],
      }),
    ];
    const detail = await buildProposalDetailForProfile("me", "LPP-RP-000001");
    expect(detail?.contactPermission).toEqual({ mine: true, theirs: false });
    expect(JSON.stringify(detail)).not.toContain("approvedById");
  });
});

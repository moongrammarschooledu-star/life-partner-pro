import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeMember { id: string; role: string; status: string; familyAccountId: string; }
interface FakeAccount { id: string; applicantId: string; status: string; }
interface FakePermission { familyMemberId: string; permission: string; scope: string | null; status: string; expiresAt: Date | null; }
interface FakeShare { familyMemberId: string; recordType: string; recordId: string; status: string; accessLevel: string; allowComments: boolean; allowResponse: boolean; expiresAt: Date | null; }

let members: Map<string, FakeMember>;
let accounts: Map<string, FakeAccount>;
let permissions: FakePermission[];
let shares: FakeShare[];
let proposals: Map<string, { id: string; proposalCode: string; profileAId: string; profileBId: string }>;

vi.mock("@/lib/family/family-member-session", () => ({ revokeAllFamilyMemberSessions: vi.fn(async () => 0) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => {}) }));

vi.mock("@/lib/visibility/proposal-visibility", async () => {
  const actual = await vi.importActual<typeof import("../visibility/proposal-visibility")>("../visibility/proposal-visibility");
  return {
    ...actual,
    buildProposalDetailForProfile: vi.fn(async (applicantId: string, proposalCode: string) => {
      const p = [...proposals.values()].find((x) => x.proposalCode === proposalCode);
      if (!p || (p.profileAId !== applicantId && p.profileBId !== applicantId)) return null;
      return {
        proposalCode: p.proposalCode,
        createdAt: new Date("2026-01-01"),
        status: "Under Review",
        compatibilityScore: 82,
        compatibilityTier: "Good Match",
        myResponse: null,
        otherProfile: { fullName: "Ayesha", profileCode: "LPP-000002", age: 27, city: "Lahore", country: "Pakistan", education: "Masters", profession: "Engineer", maritalStatus: "NEVER_MARRIED", familyType: "NUCLEAR" },
        highlights: ["Ages are well matched."],
        differences: [],
        events: [],
        contactPermission: { mine: false, theirs: false },
        meetings: [],
      };
    }),
  };
});

vi.mock("@/lib/visibility/user-data-visibility", () => ({
  buildSelfProfileView: vi.fn(async (profileId: string) =>
    profileId === "app1"
      ? {
          profileCode: "LPP-000001",
          status: "ACTIVE",
          verified: true,
          profileCompletion: 80,
          personal: { fullName: "Me", city: "Lahore" },
          education: { level: "Masters" },
          profession: { profession: "Engineer" },
          family: { familyType: "NUCLEAR", fatherOccupation: "Business" },
          lifestyle: { religion: "Islam" },
          partnerPreference: { minAge: 25 },
          photos: [],
        }
      : null
  ),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    familyMember: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const m = members.get(where.id);
        if (!m) return null;
        const acc = accounts.get(m.familyAccountId)!;
        return { id: m.id, role: m.role, status: m.status, familyAccount: { applicantId: acc.applicantId, status: acc.status } };
      }),
    },
    familyPermission: {
      findMany: vi.fn(async ({ where }: { where: { familyMemberId: string; status: string } }) => permissions.filter((p) => p.familyMemberId === where.familyMemberId && p.status === where.status)),
    },
    familySharedRecord: {
      findUnique: vi.fn(async ({ where }: { where: { familyMemberId_recordType_recordId: { familyMemberId: string; recordType: string; recordId: string } } }) => {
        const k = where.familyMemberId_recordType_recordId;
        return shares.find((s) => s.familyMemberId === k.familyMemberId && s.recordType === k.recordType && s.recordId === k.recordId) ?? null;
      }),
      findMany: vi.fn(async ({ where }: { where: { familyMemberId: string; recordType: string; status: string } }) =>
        shares.filter((s) => s.familyMemberId === where.familyMemberId && s.recordType === where.recordType && s.status === where.status)
      ),
    },
    proposal: {
      findUnique: vi.fn(async ({ where }: { where: { proposalCode?: string; id?: string } }) => {
        if (where.proposalCode) return [...proposals.values()].find((p) => p.proposalCode === where.proposalCode) ?? null;
        return proposals.get(where.id!) ?? null;
      }),
    },
  },
}));

const { getVisibleApplicantProfile, getVisibleFamilyData, getVisibleProposal, getVisibleContactData, getVisibleDocuments } = await import("./data-visibility");

function seedMember(id: string, role: string, applicantId = "app1") {
  accounts.set("acc1", { id: "acc1", applicantId, status: "ACTIVE" });
  members.set(id, { id, role, status: "ACTIVE", familyAccountId: "acc1" });
}

beforeEach(() => {
  members = new Map();
  accounts = new Map();
  permissions = [];
  shares = [];
  proposals = new Map([["prop1", { id: "prop1", proposalCode: "LPP-RP-000001", profileAId: "app1", profileBId: "other" }]]);
});

describe("getVisibleApplicantProfile", () => {
  it("returns null without profile.basic.view", async () => {
    seedMember("fm1", "FAMILY_VIEWER");
    expect(await getVisibleApplicantProfile("fm1")).toBeNull();
  });

  it("only includes sections the family member has an explicit grant for", async () => {
    seedMember("fm1", "FAMILY_VIEWER");
    permissions.push(
      { familyMemberId: "fm1", permission: "profile.basic.view", scope: null, status: "ACTIVE", expiresAt: null },
      { familyMemberId: "fm1", permission: "profile.education.view", scope: null, status: "ACTIVE", expiresAt: null }
    );
    const view = await getVisibleApplicantProfile("fm1");
    expect(view?.education).toEqual({ level: "Masters" });
    expect(view?.profession).toBeNull(); // no profile.career.view grant
    expect(view?.family).toBeNull(); // sensitive, no grant
  });

  it("getVisibleFamilyData mirrors the same gate (no separate code path bug)", async () => {
    seedMember("fm1", "FAMILY_VIEWER");
    permissions.push({ familyMemberId: "fm1", permission: "profile.basic.view", scope: null, status: "ACTIVE", expiresAt: null });
    expect(await getVisibleFamilyData("fm1")).toBeNull();
    permissions.push({ familyMemberId: "fm1", permission: "profile.family.view", scope: null, status: "ACTIVE", expiresAt: null });
    expect(await getVisibleFamilyData("fm1")).toEqual({ familyType: "NUCLEAR", fatherOccupation: "Business" });
  });
});

describe("getVisibleProposal — record-and-permission required (Decision 7)", () => {
  it("invisible with proposal.view granted but no FamilySharedRecord", async () => {
    seedMember("fm1", "FAMILY_VIEWER");
    permissions.push({ familyMemberId: "fm1", permission: "proposal.view", scope: null, status: "ACTIVE", expiresAt: null });
    expect(await getVisibleProposal("fm1", "LPP-RP-000001")).toBeNull();
  });

  it("SUMMARY level only returns the narrow base fields", async () => {
    seedMember("fm1", "FAMILY_VIEWER");
    permissions.push({ familyMemberId: "fm1", permission: "proposal.view", scope: null, status: "ACTIVE", expiresAt: null });
    shares.push({ familyMemberId: "fm1", recordType: "PROPOSAL", recordId: "prop1", status: "ACTIVE", accessLevel: "SUMMARY", allowComments: false, allowResponse: false, expiresAt: null });
    const view = await getVisibleProposal("fm1", "LPP-RP-000001");
    expect(view).toMatchObject({ proposalCode: "LPP-RP-000001", canRespond: false });
    expect((view!.otherProfile as Record<string, unknown>).education).toBeUndefined();
    expect("highlights" in view!).toBe(false);
    expect("contactPermission" in view!).toBe(false);
  });

  it("DETAILED level adds highlights/differences/familyType but still never contactPermission/meetings", async () => {
    seedMember("fm1", "FAMILY_GUARDIAN");
    permissions.push({ familyMemberId: "fm1", permission: "proposal.view", scope: null, status: "ACTIVE", expiresAt: null });
    shares.push({ familyMemberId: "fm1", recordType: "PROPOSAL", recordId: "prop1", status: "ACTIVE", accessLevel: "DETAILED", allowComments: true, allowResponse: false, expiresAt: null });
    const view = (await getVisibleProposal("fm1", "LPP-RP-000001")) as Record<string, unknown>;
    expect(view.highlights).toEqual(["Ages are well matched."]);
    expect((view.otherProfile as Record<string, unknown>).familyType).toBe("NUCLEAR");
    expect("contactPermission" in view).toBe(false);
  });

  it("RESPONSE_PARTICIPATION level is the only one exposing contactPermission/meetings and a true canRespond", async () => {
    seedMember("fm1", "FAMILY_GUARDIAN");
    permissions.push({ familyMemberId: "fm1", permission: "proposal.view", scope: null, status: "ACTIVE", expiresAt: null });
    shares.push({ familyMemberId: "fm1", recordType: "PROPOSAL", recordId: "prop1", status: "ACTIVE", accessLevel: "RESPONSE_PARTICIPATION", allowComments: true, allowResponse: true, expiresAt: null });
    const view = await getVisibleProposal("fm1", "LPP-RP-000001");
    expect(view!.canRespond).toBe(true);
    expect("contactPermission" in view!).toBe(true);
  });

  it("cross-family probe (family member of a different applicant) returns null, identical to not-found", async () => {
    seedMember("fm1", "FAMILY_VIEWER", "someone-else");
    permissions.push({ familyMemberId: "fm1", permission: "proposal.view", scope: null, status: "ACTIVE", expiresAt: null });
    shares.push({ familyMemberId: "fm1", recordType: "PROPOSAL", recordId: "prop1", status: "ACTIVE", accessLevel: "DETAILED", allowComments: true, allowResponse: false, expiresAt: null });
    expect(await getVisibleProposal("fm1", "LPP-RP-000001")).toBeNull();
  });
});

describe("Decision 9 — contact and documents always deny in this pass", () => {
  it("getVisibleContactData always returns null", () => expect(getVisibleContactData()).toBeNull());
  it("getVisibleDocuments always returns an empty list", () => expect(getVisibleDocuments()).toEqual([]));
});

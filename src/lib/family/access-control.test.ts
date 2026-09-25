import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeMember { id: string; role: string; status: string; familyAccountId: string; }
interface FakeAccount { id: string; applicantId: string; status: string; }
interface FakePermission { familyMemberId: string; permission: string; scope: string | null; status: string; expiresAt: Date | null; }
interface FakeShare { familyMemberId: string; recordType: string; recordId: string; status: string; accessLevel: string; allowComments: boolean; allowResponse: boolean; expiresAt: Date | null; }
interface FakeConsent { familyMemberId: string; consentType: string; status: string; expiresAt: Date | null; grantedAt: Date; }

let members: Map<string, FakeMember>;
let accounts: Map<string, FakeAccount>;
let permissions: FakePermission[];
let shares: FakeShare[];
let consents: FakeConsent[];
let auditCalls: Record<string, unknown>[];
let sessionRevokeCalls: string[];

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/family/family-member-session", () => ({
  revokeAllFamilyMemberSessions: vi.fn(async (id: string) => { sessionRevokeCalls.push(id); return 1; }),
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
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeMember> & { removedAt?: Date; suspendedAt?: Date; suspendedReason?: string | null } }) => {
        const m = members.get(where.id)!;
        Object.assign(m, data);
        return m;
      }),
    },
    familyPermission: {
      findMany: vi.fn(async ({ where }: { where: { familyMemberId: string; status: string } }) => permissions.filter((p) => p.familyMemberId === where.familyMemberId && p.status === where.status)),
      updateMany: vi.fn(async ({ where, data }: { where: { familyMemberId: string; revokedAt: null }; data: Partial<FakePermission> }) => {
        const matches = permissions.filter((p) => p.familyMemberId === where.familyMemberId && p.status !== "REVOKED");
        matches.forEach((p) => Object.assign(p, data));
        return { count: matches.length };
      }),
    },
    familySharedRecord: {
      findUnique: vi.fn(async ({ where }: { where: { familyMemberId_recordType_recordId: { familyMemberId: string; recordType: string; recordId: string } } }) => {
        const k = where.familyMemberId_recordType_recordId;
        return shares.find((s) => s.familyMemberId === k.familyMemberId && s.recordType === k.recordType && s.recordId === k.recordId) ?? null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { familyMemberId: string; status: string }; data: Partial<FakeShare> }) => {
        const matches = shares.filter((s) => s.familyMemberId === where.familyMemberId && s.status === where.status);
        matches.forEach((s) => Object.assign(s, data));
        return { count: matches.length };
      }),
    },
    familyConsent: {
      findFirst: vi.fn(async ({ where }: { where: { familyMemberId: string; consentType: string } }) => {
        const rows = consents.filter((c) => c.familyMemberId === where.familyMemberId && c.consentType === where.consentType).sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime());
        return rows[0] ?? null;
      }),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

const {
  getFamilyMembership,
  isFamilyMember,
  getFamilyRole,
  hasFamilyPermission,
  canAccessRecord,
  canComment,
  canRespond,
  canManageFamilyMembers,
  canApprove,
  isConsentValid,
  isAccessExpired,
  revokeAccess,
  suspendFamilyMember,
} = await import("./access-control");

function seedMember(id: string, role: string, applicantId = "app1") {
  accounts.set("acc1", { id: "acc1", applicantId, status: "ACTIVE" });
  members.set(id, { id, role, status: "ACTIVE", familyAccountId: "acc1" });
}

beforeEach(() => {
  members = new Map();
  accounts = new Map();
  permissions = [];
  shares = [];
  consents = [];
  auditCalls = [];
  sessionRevokeCalls = [];
});

describe("getFamilyMembership / isFamilyMember / getFamilyRole", () => {
  it("resolves the applicant a family member belongs to", async () => {
    seedMember("fm1", "FAMILY_VIEWER", "app1");
    const m = await getFamilyMembership("fm1");
    expect(m).toEqual({ familyMemberId: "fm1", applicantId: "app1", role: "FAMILY_VIEWER", status: "ACTIVE" });
  });

  it("returns null (not an error) for an unknown or non-ACTIVE member — deny by default", async () => {
    expect(await getFamilyMembership("nope")).toBeNull();
    expect(await isFamilyMember("nope")).toBe(false);
    expect(await getFamilyRole("nope")).toBeNull();

    seedMember("fm2", "FAMILY_VIEWER");
    members.get("fm2")!.status = "SUSPENDED";
    expect(await getFamilyMembership("fm2")).toBeNull();
  });
});

describe("hasFamilyPermission", () => {
  it("viewer cannot comment/respond/manage (no such permissions granted by default)", async () => {
    seedMember("fm1", "FAMILY_VIEWER");
    permissions.push({ familyMemberId: "fm1", permission: "proposal.view", scope: null, status: "ACTIVE", expiresAt: null });
    expect(await hasFamilyPermission("fm1", "proposal.view")).toBe(true);
    expect(await hasFamilyPermission("fm1", "proposal.comment")).toBe(false);
    expect(await hasFamilyPermission("fm1", "proposal.respond")).toBe(false);
  });

  it("an expired permission is treated as absent, not just filtered in the UI", async () => {
    seedMember("fm1", "FAMILY_ADVISOR");
    permissions.push({ familyMemberId: "fm1", permission: "proposal.comment", scope: null, status: "ACTIVE", expiresAt: new Date(Date.now() - 1000) });
    expect(await hasFamilyPermission("fm1", "proposal.comment")).toBe(false);
  });
});

describe("canAccessRecord / canComment / canRespond — record-and-permission both required (Decision 7)", () => {
  it("proposal.view alone does not grant visibility without an explicit FamilySharedRecord", async () => {
    seedMember("fm1", "FAMILY_VIEWER");
    permissions.push({ familyMemberId: "fm1", permission: "proposal.view", scope: null, status: "ACTIVE", expiresAt: null });
    expect(await canAccessRecord("fm1", "PROPOSAL" as never, "prop1")).toBe(false);
  });

  it("a shared record without the capability permission is also insufficient", async () => {
    seedMember("fm1", "FAMILY_VIEWER");
    shares.push({ familyMemberId: "fm1", recordType: "PROPOSAL", recordId: "prop1", status: "ACTIVE", accessLevel: "SUMMARY", allowComments: false, allowResponse: false, expiresAt: null });
    expect(await canAccessRecord("fm1", "PROPOSAL" as never, "prop1")).toBe(false);
  });

  it("both present together grant access", async () => {
    seedMember("fm1", "FAMILY_VIEWER");
    permissions.push({ familyMemberId: "fm1", permission: "proposal.view", scope: null, status: "ACTIVE", expiresAt: null });
    shares.push({ familyMemberId: "fm1", recordType: "PROPOSAL", recordId: "prop1", status: "ACTIVE", accessLevel: "SUMMARY", allowComments: false, allowResponse: false, expiresAt: null });
    expect(await canAccessRecord("fm1", "PROPOSAL" as never, "prop1")).toBe(true);
  });

  it("advisor CAN comment when both permission and allowComments are present", async () => {
    seedMember("fm1", "FAMILY_ADVISOR");
    permissions.push({ familyMemberId: "fm1", permission: "proposal.comment", scope: null, status: "ACTIVE", expiresAt: null });
    shares.push({ familyMemberId: "fm1", recordType: "PROPOSAL", recordId: "prop1", status: "ACTIVE", accessLevel: "STANDARD", allowComments: true, allowResponse: false, expiresAt: null });
    expect(await canComment("fm1", "PROPOSAL" as never, "prop1")).toBe(true);
  });

  it("advisor CANNOT respond without an explicit RESPONSE_PARTICIPATION grant", async () => {
    seedMember("fm1", "FAMILY_ADVISOR");
    permissions.push({ familyMemberId: "fm1", permission: "proposal.comment", scope: null, status: "ACTIVE", expiresAt: null });
    shares.push({ familyMemberId: "fm1", recordType: "PROPOSAL", recordId: "prop1", status: "ACTIVE", accessLevel: "STANDARD", allowComments: true, allowResponse: false, expiresAt: null });
    expect(await canRespond("fm1", "prop1")).toBe(false);
  });

  it("guardian CAN respond when explicitly delegated RESPONSE_PARTICIPATION + allowResponse + proposal.respond", async () => {
    seedMember("fm1", "FAMILY_GUARDIAN");
    permissions.push({ familyMemberId: "fm1", permission: "proposal.respond", scope: null, status: "ACTIVE", expiresAt: null });
    shares.push({ familyMemberId: "fm1", recordType: "PROPOSAL", recordId: "prop1", status: "ACTIVE", accessLevel: "RESPONSE_PARTICIPATION", allowComments: true, allowResponse: true, expiresAt: null });
    expect(await canRespond("fm1", "prop1")).toBe(true);
  });
});

describe("canManageFamilyMembers — FAMILY_ADMIN only, never an AdminRole capability", () => {
  it("only FAMILY_ADMIN can manage the family's own members", async () => {
    seedMember("fm1", "FAMILY_ADMIN");
    seedMember("fm2", "FAMILY_GUARDIAN");
    expect(await canManageFamilyMembers("fm1")).toBe(true);
    expect(await canManageFamilyMembers("fm2")).toBe(false);
  });
});

describe("canApprove — role-gated on top of canRespond", () => {
  it("requires FAMILY_APPROVER role even with the right permission/share", async () => {
    seedMember("fm1", "FAMILY_GUARDIAN"); // not APPROVER
    permissions.push({ familyMemberId: "fm1", permission: "proposal.respond", scope: null, status: "ACTIVE", expiresAt: null });
    shares.push({ familyMemberId: "fm1", recordType: "PROPOSAL", recordId: "prop1", status: "ACTIVE", accessLevel: "RESPONSE_PARTICIPATION", allowComments: false, allowResponse: true, expiresAt: null });
    expect(await canApprove("fm1", "prop1")).toBe(false);
  });

  it("passes for FAMILY_APPROVER with the same grants", async () => {
    seedMember("fm1", "FAMILY_APPROVER");
    permissions.push({ familyMemberId: "fm1", permission: "proposal.respond", scope: null, status: "ACTIVE", expiresAt: null });
    shares.push({ familyMemberId: "fm1", recordType: "PROPOSAL", recordId: "prop1", status: "ACTIVE", accessLevel: "RESPONSE_PARTICIPATION", allowComments: false, allowResponse: true, expiresAt: null });
    expect(await canApprove("fm1", "prop1")).toBe(true);
  });
});

describe("isConsentValid", () => {
  it("false with no consent row at all (deny by default)", async () => {
    expect(await isConsentValid("fm1", "FAMILY_INVITATION")).toBe(false);
  });

  it("true for a GRANTED, unexpired consent", async () => {
    consents.push({ familyMemberId: "fm1", consentType: "FAMILY_INVITATION", status: "GRANTED", expiresAt: null, grantedAt: new Date() });
    expect(await isConsentValid("fm1", "FAMILY_INVITATION")).toBe(true);
  });

  it("false once revoked, using the latest row", async () => {
    consents.push({ familyMemberId: "fm1", consentType: "PROPOSAL_SHARING", status: "GRANTED", expiresAt: null, grantedAt: new Date(Date.now() - 10000) });
    consents.push({ familyMemberId: "fm1", consentType: "PROPOSAL_SHARING", status: "REVOKED", expiresAt: null, grantedAt: new Date() });
    expect(await isConsentValid("fm1", "PROPOSAL_SHARING")).toBe(false);
  });
});

describe("revokeAccess / suspendFamilyMember — read-time + immediate session revocation (Decision 11)", () => {
  it("revokeAccess flips status, revokes permissions/shares, and kills active sessions immediately", async () => {
    seedMember("fm1", "FAMILY_GUARDIAN");
    permissions.push({ familyMemberId: "fm1", permission: "proposal.respond", scope: null, status: "ACTIVE", expiresAt: null });
    shares.push({ familyMemberId: "fm1", recordType: "PROPOSAL", recordId: "prop1", status: "ACTIVE", accessLevel: "RESPONSE_PARTICIPATION", allowComments: false, allowResponse: true, expiresAt: null });

    await revokeAccess("fm1", "app1", "no longer needed");

    expect(members.get("fm1")!.status).toBe("REVOKED");
    expect(permissions[0].status).toBe("REVOKED");
    expect(shares[0].status).toBe("REVOKED");
    expect(sessionRevokeCalls).toContain("fm1");
    expect(auditCalls.some((a) => a.action === "FAMILY_MEMBER_REMOVED")).toBe(true);
    // The invariant this enables: getFamilyMembership denies immediately.
    expect(await getFamilyMembership("fm1")).toBeNull();
  });

  it("suspendFamilyMember also revokes sessions immediately without removing permissions", async () => {
    seedMember("fm1", "FAMILY_GUARDIAN");
    await suspendFamilyMember("fm1", "app1", "policy violation");
    expect(members.get("fm1")!.status).toBe("SUSPENDED");
    expect(sessionRevokeCalls).toContain("fm1");
    expect(await getFamilyMembership("fm1")).toBeNull(); // SUSPENDED is not ACTIVE
  });
});

describe("isAccessExpired", () => {
  it("null expiresAt never expires", () => expect(isAccessExpired({ expiresAt: null })).toBe(false));
  it("a past date is expired", () => expect(isAccessExpired({ expiresAt: new Date(Date.now() - 1000) })).toBe(true));
  it("a future date is not expired", () => expect(isAccessExpired({ expiresAt: new Date(Date.now() + 100000) })).toBe(false));
});

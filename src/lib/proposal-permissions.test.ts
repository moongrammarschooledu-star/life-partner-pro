import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakePermission { proposalId: string; profileId: string; requestedAt: Date; approvedAt: Date | null; approvedById: string | null; revokedAt: Date | null; }
interface FakeProposal { id: string; profileAId: string; profileBId: string; assignedToId: string | null; status: string; }

let permissions: FakePermission[];
let proposals: Map<string, FakeProposal>;
let auditCalls: Record<string, unknown>[];

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/notifications/events", () => ({
  notifyContactPermissionAction: vi.fn(async () => {}),
  notifyAdminContactPermissionRequest: vi.fn(async () => {}),
  notifyContactApproved: vi.fn(async () => {}),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    proposal: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => proposals.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const p = proposals.get(where.id)!;
        if (data.status) p.status = data.status as string;
        return p;
      }),
    },
    contactPermission: {
      upsert: vi.fn(async ({ where, update, create }: { where: { proposalId_profileId: { proposalId: string; profileId: string } }; update: Partial<FakePermission>; create: Partial<FakePermission> }) => {
        const key = where.proposalId_profileId;
        const existing = permissions.find((p) => p.proposalId === key.proposalId && p.profileId === key.profileId);
        if (existing) { Object.assign(existing, update); return existing; }
        const fresh: FakePermission = { proposalId: key.proposalId, profileId: key.profileId, requestedAt: new Date(), approvedAt: null, approvedById: null, revokedAt: null, ...create };
        permissions.push(fresh);
        return fresh;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { proposalId: string; profileId: string }; data: Partial<FakePermission> }) => {
        permissions.filter((p) => p.proposalId === where.proposalId && p.profileId === where.profileId).forEach((p) => Object.assign(p, data));
      }),
      findMany: vi.fn(async ({ where }: { where: { proposalId: string } }) => permissions.filter((p) => p.proposalId === where.proposalId)),
    },
  },
}));

const { applyContactPermissionAction, ProposalPermissionError } = await import("./proposal-permissions");

beforeEach(() => {
  permissions = [];
  proposals = new Map([["prop1", { id: "prop1", profileAId: "me", profileBId: "other", assignedToId: "admin1", status: "BOTH_INTERESTED" }]]);
  auditCalls = [];
});

describe("applyContactPermissionAction — admin actor (regression)", () => {
  it("approve sets approvedById to the admin and writes CONTACT_PERMISSION_APPROVED", async () => {
    const result = await applyContactPermissionAction({ proposalId: "prop1", profileId: "me", action: "approve", actor: { type: "admin", adminId: "admin1" } });
    expect(permissions[0].approvedById).toBe("admin1");
    expect(auditCalls[0]).toMatchObject({ action: "CONTACT_PERMISSION_APPROVED", adminId: "admin1" });
    expect(result.bothApproved).toBe(false);
  });

  it("flips proposal to CONTACT_APPROVED once both sides are approved", async () => {
    await applyContactPermissionAction({ proposalId: "prop1", profileId: "me", action: "approve", actor: { type: "admin", adminId: "admin1" } });
    const result = await applyContactPermissionAction({ proposalId: "prop1", profileId: "other", action: "approve", actor: { type: "admin", adminId: "admin1" } });
    expect(result.bothApproved).toBe(true);
    expect(proposals.get("prop1")!.status).toBe("CONTACT_APPROVED");
  });
});

describe("applyContactPermissionAction — applicant actor", () => {
  it("grant (action=approve) leaves approvedById null — no admin involved", async () => {
    await applyContactPermissionAction({ proposalId: "prop1", profileId: "me", action: "approve", actor: { type: "applicant" } });
    expect(permissions[0].approvedById).toBeNull();
    expect(auditCalls[0]).toMatchObject({ action: "CONTACT_PERMISSION_GRANTED_BY_APPLICANT", adminId: null });
  });

  it("revoke writes CONTACT_PERMISSION_REVOKED_BY_APPLICANT", async () => {
    await applyContactPermissionAction({ proposalId: "prop1", profileId: "me", action: "approve", actor: { type: "applicant" } });
    await applyContactPermissionAction({ proposalId: "prop1", profileId: "me", action: "revoke", actor: { type: "applicant" } });
    expect(permissions[0].revokedAt).not.toBeNull();
    expect(auditCalls[1]).toMatchObject({ action: "CONTACT_PERMISSION_REVOKED_BY_APPLICANT" });
  });

  it("rejects the applicant 'request' action (not needed for a self-grant)", async () => {
    await expect(applyContactPermissionAction({ proposalId: "prop1", profileId: "me", action: "request", actor: { type: "applicant" } })).rejects.toThrow(ProposalPermissionError);
  });

  it("rejects a profileId not part of the proposal (IDOR)", async () => {
    await expect(applyContactPermissionAction({ proposalId: "prop1", profileId: "stranger", action: "approve", actor: { type: "applicant" } })).rejects.toThrow(/not part of this proposal/);
  });

  it("applicant self-grant can still trigger bothApproved/CONTACT_APPROVED", async () => {
    await applyContactPermissionAction({ proposalId: "prop1", profileId: "me", action: "approve", actor: { type: "applicant" } });
    const result = await applyContactPermissionAction({ proposalId: "prop1", profileId: "other", action: "approve", actor: { type: "applicant" } });
    expect(result.bothApproved).toBe(true);
    expect(proposals.get("prop1")!.status).toBe("CONTACT_APPROVED");
  });
});

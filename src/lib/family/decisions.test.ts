import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeDecision { id: string; decisionCode: string; proposalId: string; familyMemberId: string; decision: string; comment: string | null; status: string; createdAt: Date; confirmedAt: Date | null; cancelledAt: Date | null; }

let decisions: Map<string, FakeDecision>;
let proposals: Map<string, { id: string; proposalCode: string; profileAId: string; profileBId: string; status: string; assignedToId: string | null }>;
let auditCalls: Record<string, unknown>[];
let idCounter = 0;
let seqCounter = 0;
let canRespondResult = true;
let membershipResult: { familyMemberId: string; applicantId: string; role: string; status: string } | null = { familyMemberId: "fm1", applicantId: "app1", role: "FAMILY_GUARDIAN", status: "ACTIVE" };

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/notifications/events", () => ({ notifyFamilyDecisionRequested: vi.fn(async () => {}) }));
vi.mock("@/lib/family/access-control", () => ({
  canRespond: vi.fn(async () => canRespondResult),
  getFamilyMembership: vi.fn(async () => membershipResult),
}));
vi.mock("@/lib/proposal-response", () => ({ submitProposalResponse: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    familyDecision: {
      create: vi.fn(async ({ data }: { data: Omit<FakeDecision, "id" | "createdAt" | "confirmedAt" | "cancelledAt"> }) => {
        const row: FakeDecision = { id: `dec${++idCounter}`, createdAt: new Date(), confirmedAt: null, cancelledAt: null, ...data };
        decisions.set(row.id, row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; proposal: { OR: { profileAId?: string; profileBId?: string }[] } } }) => {
        const d = decisions.get(where.id);
        if (!d) return null;
        const p = proposals.get(d.proposalId);
        const ids = where.proposal.OR.map((c) => c.profileAId ?? c.profileBId);
        return p && (ids.includes(p.profileAId) || ids.includes(p.profileBId)) ? d : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeDecision> }) => {
        const d = decisions.get(where.id)!;
        Object.assign(d, data);
        return d;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: string; proposal: { OR: { profileAId?: string; profileBId?: string }[] } }; data: Partial<FakeDecision> }) => {
        const d = decisions.get(where.id);
        if (!d || d.status !== where.status) return { count: 0 };
        const p = proposals.get(d.proposalId);
        const ids = where.proposal.OR.map((c) => c.profileAId ?? c.profileBId);
        if (!p || !(ids.includes(p.profileAId) || ids.includes(p.profileBId))) return { count: 0 };
        Object.assign(d, data);
        return { count: 1 };
      }),
      findMany: vi.fn(async () => []),
    },
    proposal: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => proposals.get(where.id) ?? null),
    },
    sequenceCounter: { upsert: vi.fn(async () => ({ lastSeq: ++seqCounter })) },
  },
}));

const { suggestProposalResponse, confirmFamilyDecision, cancelFamilyDecision, FamilyDecisionError } = await import("./decisions");

beforeEach(() => {
  decisions = new Map();
  proposals = new Map([["prop1", { id: "prop1", proposalCode: "LPP-RP-000001", profileAId: "app1", profileBId: "other", status: "BOTH_INTERESTED", assignedToId: null }]]);
  auditCalls = [];
  canRespondResult = true;
  membershipResult = { familyMemberId: "fm1", applicantId: "app1", role: "FAMILY_GUARDIAN", status: "ACTIVE" };
});

describe("suggestProposalResponse", () => {
  it("creates a non-binding FamilyDecision awaiting confirmation", async () => {
    const row = await suggestProposalResponse({ familyMemberId: "fm1", proposalId: "prop1", decision: "INTERESTED" as never });
    expect(row.status).toBe("APPLICANT_CONFIRMATION_REQUIRED");
    expect(auditCalls[0]).toMatchObject({ action: "FAMILY_DECISION_CREATED", actorFamilyMemberId: "fm1", targetProfileId: "app1" });
  });

  it("rejects when canRespond is false (no RESPONSE_PARTICIPATION share, or missing proposal.respond)", async () => {
    canRespondResult = false;
    await expect(suggestProposalResponse({ familyMemberId: "fm1", proposalId: "prop1", decision: "INTERESTED" as never })).rejects.toThrow(FamilyDecisionError);
  });
});

describe("confirmFamilyDecision — the only path to a real ProposalResponse", () => {
  it("converts a pending decision into a real response via submitProposalResponse", async () => {
    const { submitProposalResponse } = await import("@/lib/proposal-response");
    const row = await suggestProposalResponse({ familyMemberId: "fm1", proposalId: "prop1", decision: "NOT_INTERESTED" as never });
    const result = await confirmFamilyDecision("app1", row.id);
    expect(result).toEqual({ ok: true });
    expect(decisions.get(row.id)!.status).toBe("CONFIRMED");
    expect(submitProposalResponse).toHaveBeenCalledWith("app1", "LPP-RP-000001", "NOT_INTERESTED");
  });

  it("404s for a decision belonging to a different applicant's proposal (IDOR)", async () => {
    const row = await suggestProposalResponse({ familyMemberId: "fm1", proposalId: "prop1", decision: "INTERESTED" as never });
    await expect(confirmFamilyDecision("someone-else", row.id)).rejects.toThrow(/not found/i);
  });

  it("rejects confirming an already-confirmed decision", async () => {
    const row = await suggestProposalResponse({ familyMemberId: "fm1", proposalId: "prop1", decision: "INTERESTED" as never });
    await confirmFamilyDecision("app1", row.id);
    await expect(confirmFamilyDecision("app1", row.id)).rejects.toThrow(/not awaiting confirmation/i);
  });
});

describe("cancelFamilyDecision", () => {
  it("cancels a pending decision", async () => {
    const row = await suggestProposalResponse({ familyMemberId: "fm1", proposalId: "prop1", decision: "INTERESTED" as never });
    await cancelFamilyDecision("app1", row.id);
    expect(decisions.get(row.id)!.status).toBe("CANCELLED");
  });

  it("404s for another applicant's decision", async () => {
    const row = await suggestProposalResponse({ familyMemberId: "fm1", proposalId: "prop1", decision: "INTERESTED" as never });
    await expect(cancelFamilyDecision("someone-else", row.id)).rejects.toThrow(FamilyDecisionError);
  });
});

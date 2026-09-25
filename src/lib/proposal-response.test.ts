import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeProposal { id: string; proposalCode: string; profileAId: string; profileBId: string; status: string; assignedToId: string | null; }
interface FakeResponse { proposalId: string; profileId: string; response: string; reason: string | null; reasonNote: string | null; respondedAt: Date; }

let proposals: Map<string, FakeProposal>;
let responses: Map<string, FakeResponse>;
let auditCalls: Record<string, unknown>[];
let notifyCalls: Record<string, unknown>[];

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/notifications/events", () => ({ notifyProposalResponseReceived: vi.fn(async (call: Record<string, unknown>) => { notifyCalls.push(call); }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    proposal: {
      findUnique: vi.fn(async ({ where }: { where: { proposalCode: string } }) => [...proposals.values()].find((p) => p.proposalCode === where.proposalCode) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { status: string } }) => {
        const p = [...proposals.values()].find((x) => x.id === where.id)!;
        p.status = data.status;
        return p;
      }),
    },
    proposalResponse: {
      upsert: vi.fn(async ({ where, create }: { where: { proposalId_profileId: { proposalId: string; profileId: string } }; create: FakeResponse }) => {
        const key = `${where.proposalId_profileId.proposalId}:${where.proposalId_profileId.profileId}`;
        const row = { ...create, respondedAt: new Date() };
        responses.set(key, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: { proposalId_profileId: { proposalId: string; profileId: string } } }) => {
        const key = `${where.proposalId_profileId.proposalId}:${where.proposalId_profileId.profileId}`;
        return responses.get(key) ?? null;
      }),
    },
  },
}));

const { submitProposalResponse, ProposalResponseError } = await import("./proposal-response");

beforeEach(() => {
  proposals = new Map([["LPP-RP-000001", { id: "prop1", proposalCode: "LPP-RP-000001", profileAId: "me", profileBId: "other", status: "PROPOSAL_CREATED", assignedToId: "admin1" }]]);
  responses = new Map();
  auditCalls = [];
  notifyCalls = [];
});

describe("submitProposalResponse", () => {
  it("upserts a response, transitions status, and audits/notifies", async () => {
    const result = await submitProposalResponse("me", "LPP-RP-000001", "INTERESTED");
    expect(result).toEqual({ ok: true });
    expect(proposals.get("LPP-RP-000001")!.status).toBe("WAITING_FOR_PROFILE_B");
    expect(auditCalls[0]).toMatchObject({ action: "PROPOSAL_RESPONSE_SUBMITTED", targetProfileId: "me" });
    expect(notifyCalls).toHaveLength(1);
  });

  it("both sides interested reaches BOTH_INTERESTED", async () => {
    await submitProposalResponse("me", "LPP-RP-000001", "INTERESTED");
    await submitProposalResponse("other", "LPP-RP-000001", "INTERESTED");
    expect(proposals.get("LPP-RP-000001")!.status).toBe("BOTH_INTERESTED");
  });

  it("rejects an invalid response value", async () => {
    await expect(submitProposalResponse("me", "LPP-RP-000001", "MAYBE" as never)).rejects.toThrow(ProposalResponseError);
  });

  it("rejects an invalid decline reason", async () => {
    await expect(submitProposalResponse("me", "LPP-RP-000001", "NOT_INTERESTED", "BECAUSE" as never)).rejects.toThrow(/invalid reason/i);
  });

  it("404s identically for a nonexistent proposal and one the caller isn't part of (no enumeration)", async () => {
    await expect(submitProposalResponse("me", "LPP-RP-999999", "INTERESTED")).rejects.toThrow(/not found/i);
    await expect(submitProposalResponse("stranger", "LPP-RP-000001", "INTERESTED")).rejects.toThrow(/not found/i);
  });

  it("changing a mind re-upserts rather than creating a duplicate row", async () => {
    await submitProposalResponse("me", "LPP-RP-000001", "INTERESTED");
    await submitProposalResponse("me", "LPP-RP-000001", "NOT_INTERESTED", "LOCATION", "too far");
    expect(responses.size).toBe(1);
    expect(proposals.get("LPP-RP-000001")!.status).toBe("REJECTED");
  });
});

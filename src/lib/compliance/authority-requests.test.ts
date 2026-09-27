import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeRequest {
  id: string; requestCode: string; requestType: string; authority: string; jurisdictionId: string | null;
  receivedAt: Date; requestReference: string | null; scope: string; deadline: Date | null;
  verificationStatus: string; legalReviewStatus: string; approvedDisclosureScope: string | null;
  disclosedData: string | null; disclosureDate: Date | null; reviewerId: string | null; approvalId: string | null;
}

let requests: Map<string, FakeRequest>;
let seq = 0;
let auditCalls: Record<string, unknown>[];
let gateCalls: Record<string, unknown>[];
let gateResult: { requiresApproval: boolean; status?: string; approvalRequestId?: string; approvalCode?: string };
let executedCalls: string[];
let taskCalls: Record<string, unknown>[];

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async () => `LPP-AUTHREQ-${String(++seq).padStart(6, "0")}`) }));
vi.mock("@/lib/workflow/engine", () => ({ createTask: vi.fn(async (call: Record<string, unknown>) => { taskCalls.push(call); return { id: "task1" }; }) }));
vi.mock("@/lib/approvals/gate", () => ({
  enforceApprovalGate: vi.fn(async (params: Record<string, unknown>) => { gateCalls.push(params); return gateResult; }),
  markApprovalExecuted: vi.fn(async (id: string) => { executedCalls.push(id); }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    authorityRequest: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `req${requests.size + 1}`, receivedAt: new Date(), ...data } as FakeRequest;
        requests.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = requests.get(where.id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...data } as FakeRequest;
        requests.set(where.id, updated);
        return updated;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = requests.get(where.id);
        if (!row) throw new Error("not found");
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => requests.get(where.id) ?? null),
      findMany: vi.fn(async () => [...requests.values()]),
    },
  },
}));

const { createAuthorityRequest, recordVerification, recordLegalReview, discloseToAuthority } = await import("./authority-requests");

const actor = { id: "admin1", name: "A", email: "a@x.com", role: "SUPER_ADMIN", permissions: [], sid: "s1" } as never;

async function makeRequest() {
  return createAuthorityRequest({ requestType: "LAW_ENFORCEMENT" as never, authority: "Local Police", scope: "profile identity records for case #123" }, actor);
}

beforeEach(() => {
  requests = new Map();
  seq = 0;
  auditCalls = [];
  gateCalls = [];
  executedCalls = [];
  gateResult = { requiresApproval: false };
  taskCalls = [];
});

describe("createAuthorityRequest", () => {
  it("always starts UNVERIFIED / PENDING — never pre-approved", async () => {
    const request = await makeRequest();
    expect(request.verificationStatus).toBe("UNVERIFIED");
    expect(request.legalReviewStatus).toBe("PENDING");
  });

  it("creates an AUTHORITY_REQUEST_REVIEW task so it surfaces in the task queue", async () => {
    const request = await makeRequest();
    expect(taskCalls[0]).toMatchObject({ taskType: "AUTHORITY_REQUEST_REVIEW", resourceType: "CASE", resourceId: request.id, priority: "HIGH" });
  });
});

describe("discloseToAuthority — the safety-critical gate", () => {
  it("refuses disclosure when verification has not happened at all", async () => {
    const request = await makeRequest();
    await recordLegalReview(request.id, "APPROVED", actor, "counsel signed off");
    await expect(discloseToAuthority(request.id, "identity docs only", { name: "x" }, actor, "reason")).rejects.toThrow(/unverified/i);
  });

  it("refuses disclosure when verification failed, even if legal review approved", async () => {
    const request = await makeRequest();
    await recordVerification(request.id, false, actor, "could not confirm authenticity");
    await recordLegalReview(request.id, "APPROVED", actor, "counsel signed off");
    await expect(discloseToAuthority(request.id, "identity docs only", {}, actor, "reason")).rejects.toThrow();
  });

  it("refuses disclosure when verified but legal review has not approved", async () => {
    const request = await makeRequest();
    await recordVerification(request.id, true, actor, "confirmed via official channel");
    await expect(discloseToAuthority(request.id, "identity docs only", {}, actor, "reason")).rejects.toThrow(/legal review/i);
  });

  it("refuses disclosure when legal review explicitly rejected, even if verified", async () => {
    const request = await makeRequest();
    await recordVerification(request.id, true, actor, "confirmed");
    await recordLegalReview(request.id, "REJECTED", actor, "scope too broad");
    await expect(discloseToAuthority(request.id, "identity docs only", {}, actor, "reason")).rejects.toThrow();
  });

  it("goes through the STEP-19 gate only once both checks independently clear", async () => {
    const request = await makeRequest();
    await recordVerification(request.id, true, actor, "confirmed");
    await recordLegalReview(request.id, "APPROVED", actor, "counsel signed off");

    const result = await discloseToAuthority(request.id, "identity docs only", { doc: "x" }, actor, "final disclosure");
    expect(gateCalls[0]).toMatchObject({ actionType: "AUTHORITY_DISCLOSURE_APPROVAL" });
    expect(result.requiresApproval).toBe(false);
    expect(result.request?.disclosedData).toBeTruthy();
    expect(result.request?.disclosureDate).toBeInstanceOf(Date);
  });

  it("does not write disclosedData while the gate is still pending", async () => {
    gateResult = { requiresApproval: true, status: "ALREADY_PENDING", approvalRequestId: "ar1", approvalCode: "LPP-APR-000001" };
    const request = await makeRequest();
    await recordVerification(request.id, true, actor, "confirmed");
    await recordLegalReview(request.id, "APPROVED", actor, "counsel signed off");

    const result = await discloseToAuthority(request.id, "identity docs only", {}, actor, "reason");
    expect(result.requiresApproval).toBe(true);
    expect(requests.get(request.id)?.disclosedData ?? null).toBeNull();
    expect(executedCalls).toHaveLength(0);
  });
});

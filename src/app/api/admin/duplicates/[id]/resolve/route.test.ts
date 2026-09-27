import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/route-guard", async () => {
  const { NextResponse } = await import("next/server");
  return {
    ApiError: class ApiError extends Error {
      status: number;
      constructor(status: number, message: string) {
        super(message);
        this.status = status;
      }
    },
    requireAdmin: vi.fn(async () => ({ id: "admin1", role: "VERIFICATION_MANAGER", permissions: ["duplicates:resolve"] })),
    handleApiError: (error: unknown) => {
      const status = error && typeof error === "object" && "status" in error ? (error as { status: number }).status : 500;
      return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status });
    },
  };
});

let gateResult: { requiresApproval: boolean; status?: string; approvalRequestId?: string; approvalCode?: string } = { requiresApproval: false };
const gateCalls: Record<string, unknown>[] = [];
const executedCalls: string[] = [];
vi.mock("@/lib/approvals/gate", () => ({
  enforceApprovalGate: vi.fn(async (params: Record<string, unknown>) => {
    gateCalls.push(params);
    return gateResult;
  }),
  markApprovalExecuted: vi.fn(async (id: string) => { executedCalls.push(id); }),
}));

const resolveCalls: Record<string, unknown>[] = [];
vi.mock("@/lib/verification/account-relationships", () => ({
  resolveDuplicateCandidate: vi.fn(async (id: string, opts: Record<string, unknown>) => {
    resolveCalls.push({ id, ...opts });
    return { id, status: opts.decision, profileId: "p1" };
  }),
}));

let candidate: { id: string; profileId: string; candidateProfileId: string; securityFlagId: string | null } | null;
vi.mock("@/lib/prisma", () => ({
  prisma: { duplicateCandidate: { findUnique: vi.fn(async () => candidate) } },
}));

const { POST } = await import("./route");

function req(body: unknown) {
  return new Request("http://x", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  candidate = { id: "c1", profileId: "p1", candidateProfileId: "p2", securityFlagId: "f1" };
  gateResult = { requiresApproval: false };
  gateCalls.length = 0;
  executedCalls.length = 0;
  resolveCalls.length = 0;
});

describe("POST /api/admin/duplicates/[id]/resolve", () => {
  it("requires a valid decision", async () => {
    const res = await POST(req({ decision: "MAYBE", resolution: "x" }), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(400);
  });

  it("requires a resolution note", async () => {
    const res = await POST(req({ decision: "NOT_DUPLICATE" }), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(400);
  });

  it("404s for a nonexistent candidate", async () => {
    candidate = null;
    const res = await POST(req({ decision: "NOT_DUPLICATE", resolution: "x" }), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(404);
  });

  it("NOT_DUPLICATE never goes through the approval gate", async () => {
    const res = await POST(req({ decision: "NOT_DUPLICATE", resolution: "different people" }), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    expect(gateCalls).toHaveLength(0);
    expect(resolveCalls[0]).toMatchObject({ id: "c1", decision: "NOT_DUPLICATE" });
  });

  it("CONFIRMED_DUPLICATE goes through the approval gate with sourceType SECURITY_FLAG", async () => {
    const res = await POST(req({ decision: "CONFIRMED_DUPLICATE", resolution: "same phone and email" }), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    expect(gateCalls[0]).toMatchObject({ actionType: "DUPLICATE_CONFIRMATION", sourceType: "SECURITY_FLAG", sourceId: "f1" });
    expect(resolveCalls[0]).toMatchObject({ id: "c1", decision: "CONFIRMED_DUPLICATE" });
  });

  it("when the gate requires approval and isn't ready, returns 202 without resolving anything yet", async () => {
    gateResult = { requiresApproval: true, status: "CREATED", approvalRequestId: "ar1", approvalCode: "LPP-APR-000001" };
    const res = await POST(req({ decision: "CONFIRMED_DUPLICATE", resolution: "same phone and email" }), { params: Promise.resolve({ id: "c1" }) });
    const json = await res.json();
    expect(res.status).toBe(202);
    expect(json).toMatchObject({ approvalRequired: true, approvalCode: "LPP-APR-000001" });
    expect(resolveCalls).toHaveLength(0);
  });

  it("when the gate is READY_TO_EXECUTE, resolves and marks the approval executed", async () => {
    gateResult = { requiresApproval: true, status: "READY_TO_EXECUTE", approvalRequestId: "ar1", approvalCode: "LPP-APR-000001" };
    const res = await POST(req({ decision: "CONFIRMED_DUPLICATE", resolution: "same phone and email" }), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    expect(resolveCalls).toHaveLength(1);
    expect(executedCalls).toEqual(["ar1"]);
  });
});

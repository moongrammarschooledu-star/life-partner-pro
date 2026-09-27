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
    requireAdmin: vi.fn(async () => ({ id: "admin1", role: "SUPER_ADMIN", permissions: ["privacy:hold:manage"] })),
    handleApiError: (error: unknown) => {
      const status = error && typeof error === "object" && "status" in error ? (error as { status: number }).status : 500;
      return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status });
    },
  };
});

let requestResult: { requiresApproval: boolean; status?: string; approvalRequestId?: string; approvalCode?: string };
let executeCalls: Array<{ holdId: string; approvalRequestId?: string }>;
let requestCalls: Array<{ holdId: string; reason: string }>;

vi.mock("@/lib/compliance/legal-hold", () => ({
  requestHoldRelease: vi.fn(async (holdId: string, _actor: unknown, reason: string) => {
    requestCalls.push({ holdId, reason });
    return requestResult;
  }),
  executeHoldRelease: vi.fn(async (holdId: string, _actor: unknown, approvalRequestId?: string) => {
    executeCalls.push({ holdId, approvalRequestId });
    return { id: holdId, active: false, holdStatus: "RELEASED" };
  }),
}));

const { DELETE } = await import("./route");

function req(body: unknown) {
  return new Request("http://x", { method: "DELETE", body: JSON.stringify(body) });
}

beforeEach(() => {
  requestResult = { requiresApproval: false };
  executeCalls = [];
  requestCalls = [];
});

describe("DELETE /api/admin/privacy-center/holds/[id]", () => {
  it("requires a reason", async () => {
    const res = await DELETE(req({}), { params: Promise.resolve({ id: "hold1" }) });
    expect(res.status).toBe(400);
    expect(requestCalls).toHaveLength(0);
  });

  it("no longer lifts the hold unilaterally — it requests release first", async () => {
    await DELETE(req({ reason: "case closed" }), { params: Promise.resolve({ id: "hold1" }) });
    expect(requestCalls).toEqual([{ holdId: "hold1", reason: "case closed" }]);
  });

  it("returns 202 with approval details while the gate is still pending, and never executes the release", async () => {
    requestResult = { requiresApproval: true, status: "ALREADY_PENDING", approvalRequestId: "ar1", approvalCode: "LPP-APR-000001" };
    const res = await DELETE(req({ reason: "case closed" }), { params: Promise.resolve({ id: "hold1" }) });
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body).toMatchObject({ approvalRequired: true, approvalCode: "LPP-APR-000001", status: "ALREADY_PENDING" });
    expect(executeCalls).toHaveLength(0);
  });

  it("executes the release once the gate reports READY_TO_EXECUTE", async () => {
    requestResult = { requiresApproval: true, status: "READY_TO_EXECUTE", approvalRequestId: "ar1" };
    const res = await DELETE(req({ reason: "case closed" }), { params: Promise.resolve({ id: "hold1" }) });

    expect(res.status).toBe(200);
    expect(executeCalls).toEqual([{ holdId: "hold1", approvalRequestId: "ar1" }]);
  });

  it("executes immediately when the action doesn't require approval at all", async () => {
    requestResult = { requiresApproval: false };
    const res = await DELETE(req({ reason: "case closed" }), { params: Promise.resolve({ id: "hold1" }) });

    expect(res.status).toBe(200);
    expect(executeCalls).toEqual([{ holdId: "hold1", approvalRequestId: undefined }]);
  });
});

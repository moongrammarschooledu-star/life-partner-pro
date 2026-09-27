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
    requireAdmin: vi.fn(async () => ({ id: "admin1", role: "SUPER_ADMIN", permissions: [] })),
    handleApiError: (error: unknown) => {
      const status = error && typeof error === "object" && "status" in error ? (error as { status: number }).status : 500;
      return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status });
    },
  };
});

let request: Record<string, unknown> | null;
let discloseResult: { requiresApproval: boolean; request?: Record<string, unknown>; status?: string; approvalCode?: string };
let discloseCalls: Record<string, unknown>[];

vi.mock("@/lib/compliance/authority-requests", () => ({
  getAuthorityRequest: vi.fn(async (id: string) => (request && request.id === id ? request : null)),
  discloseToAuthority: vi.fn(async (id: string, scope: string, data: unknown, _actor: unknown, reason: string) => {
    discloseCalls.push({ id, scope, data, reason });
    return discloseResult;
  }),
}));

const { POST } = await import("./route");

function postReq(body: unknown) {
  return new Request("http://x", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  request = { id: "req1", verificationStatus: "VERIFIED", legalReviewStatus: "APPROVED" };
  discloseResult = { requiresApproval: false, request: { id: "req1", disclosedData: "{}" } };
  discloseCalls = [];
});

describe("POST /api/admin/compliance/authority-requests/[id]/disclose", () => {
  it("404s for an unknown id", async () => {
    const res = await POST(postReq({ approvedDisclosureScope: "x", disclosedData: {}, reason: "x" }), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
    expect(discloseCalls).toHaveLength(0);
  });

  it("409s when the request has not been verified — never reaches discloseToAuthority", async () => {
    request = { id: "req1", verificationStatus: "UNVERIFIED", legalReviewStatus: "APPROVED" };
    const res = await POST(postReq({ approvedDisclosureScope: "x", disclosedData: {}, reason: "x" }), { params: Promise.resolve({ id: "req1" }) });
    expect(res.status).toBe(409);
    expect(discloseCalls).toHaveLength(0);
  });

  it("409s when legal review has not approved — never reaches discloseToAuthority", async () => {
    request = { id: "req1", verificationStatus: "VERIFIED", legalReviewStatus: "PENDING" };
    const res = await POST(postReq({ approvedDisclosureScope: "x", disclosedData: {}, reason: "x" }), { params: Promise.resolve({ id: "req1" }) });
    expect(res.status).toBe(409);
    expect(discloseCalls).toHaveLength(0);
  });

  it("requires approvedDisclosureScope, disclosedData and reason", async () => {
    const res = await POST(postReq({}), { params: Promise.resolve({ id: "req1" }) });
    expect(res.status).toBe(400);
    expect(discloseCalls).toHaveLength(0);
  });

  it("discloses once both preconditions hold and the gate clears immediately", async () => {
    const res = await POST(postReq({ approvedDisclosureScope: "identity docs only", disclosedData: { doc: "x" }, reason: "final disclosure" }), { params: Promise.resolve({ id: "req1" }) });
    expect(res.status).toBe(200);
    expect(discloseCalls[0]).toMatchObject({ id: "req1", scope: "identity docs only" });
  });

  it("returns 202 with approval details when the STEP-19 gate is still pending", async () => {
    discloseResult = { requiresApproval: true, status: "CREATED", approvalCode: "LPP-APR-000001" };
    const res = await POST(postReq({ approvedDisclosureScope: "x", disclosedData: {}, reason: "x" }), { params: Promise.resolve({ id: "req1" }) });
    expect(res.status).toBe(202);
    expect((await res.json())).toMatchObject({ approvalRequired: true, approvalCode: "LPP-APR-000001" });
  });
});

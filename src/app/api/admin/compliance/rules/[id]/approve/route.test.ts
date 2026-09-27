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
    requireAdmin: vi.fn(async () => ({ id: "admin1", role: "COMPLIANCE_MANAGER", permissions: [] })),
    handleApiError: (error: unknown) => {
      const status = error && typeof error === "object" && "status" in error ? (error as { status: number }).status : 500;
      return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status });
    },
  };
});

let rule: Record<string, unknown> | null;
let approveResult: { requiresApproval: boolean; rule?: Record<string, unknown>; status?: string; approvalCode?: string };
let approveCalls: Array<{ id: string; reason: string }>;

vi.mock("@/lib/compliance/rules", () => ({
  getRule: vi.fn(async (id: string) => (rule && rule.id === id ? rule : null)),
  approveRule: vi.fn(async (id: string, _actor: unknown, reason: string) => {
    approveCalls.push({ id, reason });
    return approveResult;
  }),
}));

const { POST } = await import("./route");

function req(body: unknown) {
  return new Request("http://x", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  rule = { id: "r1", status: "UNDER_REVIEW" };
  approveResult = { requiresApproval: false, rule: { id: "r1", status: "APPROVED" } };
  approveCalls = [];
});

describe("POST /api/admin/compliance/rules/[id]/approve", () => {
  it("404s for an unknown rule", async () => {
    const res = await POST(req({ reason: "ok" }), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
    expect(approveCalls).toHaveLength(0);
  });

  it("409s when the rule is not UNDER_REVIEW", async () => {
    rule = { id: "r1", status: "DRAFT" };
    const res = await POST(req({ reason: "ok" }), { params: Promise.resolve({ id: "r1" }) });
    expect(res.status).toBe(409);
    expect(approveCalls).toHaveLength(0);
  });

  it("requires a reason", async () => {
    const res = await POST(req({}), { params: Promise.resolve({ id: "r1" }) });
    expect(res.status).toBe(400);
    expect(approveCalls).toHaveLength(0);
  });

  it("approves and returns the rule when the gate clears immediately", async () => {
    const res = await POST(req({ reason: "legal review complete" }), { params: Promise.resolve({ id: "r1" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("APPROVED");
  });

  it("returns 202 with approval details when the gate is still pending", async () => {
    approveResult = { requiresApproval: true, status: "CREATED", approvalCode: "LPP-APR-000001" };
    const res = await POST(req({ reason: "legal review complete" }), { params: Promise.resolve({ id: "r1" }) });
    expect(res.status).toBe(202);
    expect((await res.json())).toMatchObject({ approvalRequired: true, approvalCode: "LPP-APR-000001" });
  });
});

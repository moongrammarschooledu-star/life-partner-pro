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
let suspendCalls: Array<{ id: string; reason: string }>;

vi.mock("@/lib/compliance/rules", () => ({
  getRule: vi.fn(async (id: string) => (rule && rule.id === id ? rule : null)),
  suspendRule: vi.fn(async (id: string, _actor: unknown, reason: string) => {
    suspendCalls.push({ id, reason });
    return { id, status: "SUSPENDED" };
  }),
}));

const { POST } = await import("./route");

function req(body: unknown) {
  return new Request("http://x", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  rule = { id: "r1", status: "ACTIVE" };
  suspendCalls = [];
});

describe("POST /api/admin/compliance/rules/[id]/suspend", () => {
  it("404s for an unknown rule", async () => {
    const res = await POST(req({ reason: "x" }), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("409s when the rule is not ACTIVE", async () => {
    rule = { id: "r1", status: "DRAFT" };
    const res = await POST(req({ reason: "x" }), { params: Promise.resolve({ id: "r1" }) });
    expect(res.status).toBe(409);
    expect(suspendCalls).toHaveLength(0);
  });

  it("requires a reason", async () => {
    const res = await POST(req({}), { params: Promise.resolve({ id: "r1" }) });
    expect(res.status).toBe(400);
    expect(suspendCalls).toHaveLength(0);
  });

  it("suspends an ACTIVE rule", async () => {
    const res = await POST(req({ reason: "policy conflict found" }), { params: Promise.resolve({ id: "r1" }) });
    expect(res.status).toBe(200);
    expect(suspendCalls[0]).toMatchObject({ id: "r1", reason: "policy conflict found" });
  });
});

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
let activateCalls: string[];

vi.mock("@/lib/compliance/rules", () => ({
  getRule: vi.fn(async (id: string) => (rule && rule.id === id ? rule : null)),
  activateRule: vi.fn(async (id: string) => {
    activateCalls.push(id);
    return { id, status: "ACTIVE" };
  }),
}));

const { POST } = await import("./route");

beforeEach(() => {
  rule = { id: "r1", status: "APPROVED" };
  activateCalls = [];
});

describe("POST /api/admin/compliance/rules/[id]/activate", () => {
  it("404s for an unknown rule", async () => {
    const res = await POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("409s when the rule is not APPROVED", async () => {
    rule = { id: "r1", status: "DRAFT" };
    const res = await POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id: "r1" }) });
    expect(res.status).toBe(409);
    expect(activateCalls).toHaveLength(0);
  });

  it("activates an APPROVED rule", async () => {
    const res = await POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id: "r1" }) });
    expect(res.status).toBe(200);
    expect(activateCalls).toEqual(["r1"]);
  });
});

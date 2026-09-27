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
let updateCalls: Array<Record<string, unknown>>;
let submitCalls: string[];

vi.mock("@/lib/compliance/rules", () => ({
  getRule: vi.fn(async (id: string) => (rule && rule.id === id ? rule : null)),
  updateDraftRule: vi.fn(async (id: string, patch: Record<string, unknown>) => {
    updateCalls.push(patch);
    return { ...rule, ...patch };
  }),
  submitRuleForReview: vi.fn(async (id: string) => {
    submitCalls.push(id);
    return { ...rule, status: "UNDER_REVIEW" };
  }),
}));

const { GET, PATCH } = await import("./route");

function patchReq(body: unknown) {
  return new Request("http://x", { method: "PATCH", body: JSON.stringify(body) });
}

beforeEach(() => {
  rule = { id: "r1", status: "DRAFT" };
  updateCalls = [];
  submitCalls = [];
});

describe("GET /api/admin/compliance/rules/[id]", () => {
  it("404s for an unknown id", async () => {
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/admin/compliance/rules/[id]", () => {
  it("404s for an unknown id", async () => {
    const res = await PATCH(patchReq({ description: "x" }), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
    expect(updateCalls).toHaveLength(0);
  });

  it("edits a DRAFT rule", async () => {
    const res = await PATCH(patchReq({ description: "revised" }), { params: Promise.resolve({ id: "r1" }) });
    expect(res.status).toBe(200);
    expect(updateCalls[0]).toMatchObject({ description: "revised" });
  });

  it("refuses to edit an ACTIVE rule with a 409, not a 500", async () => {
    rule = { id: "r1", status: "ACTIVE" };
    const res = await PATCH(patchReq({ description: "sneaky" }), { params: Promise.resolve({ id: "r1" }) });
    expect(res.status).toBe(409);
    expect(updateCalls).toHaveLength(0);
  });

  it("submits a DRAFT rule for review via { submit: true }", async () => {
    const res = await PATCH(patchReq({ submit: true }), { params: Promise.resolve({ id: "r1" }) });
    expect(res.status).toBe(200);
    expect(submitCalls).toEqual(["r1"]);
  });

  it("refuses to submit a non-DRAFT rule for review", async () => {
    rule = { id: "r1", status: "UNDER_REVIEW" };
    const res = await PATCH(patchReq({ submit: true }), { params: Promise.resolve({ id: "r1" }) });
    expect(res.status).toBe(409);
    expect(submitCalls).toHaveLength(0);
  });
});

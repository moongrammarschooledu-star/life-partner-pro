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

let processor: Record<string, unknown> | null;
let updateCalls: Array<Record<string, unknown>>;
let reviewCalls: Array<{ id: string; status: string; note: string }>;

vi.mock("@/lib/compliance/processors", () => ({
  getProcessor: vi.fn(async (id: string) => (processor && processor.id === id ? processor : null)),
  updateProcessor: vi.fn(async (id: string, patch: Record<string, unknown>) => {
    updateCalls.push(patch);
    return { ...processor, ...patch };
  }),
  recordProcessorReview: vi.fn(async (id: string, status: string, _actor: unknown, note: string) => {
    reviewCalls.push({ id, status, note });
    return { ...processor, complianceStatus: status };
  }),
}));

const { GET, PATCH } = await import("./route");

function patchReq(body: unknown) {
  return new Request("http://x", { method: "PATCH", body: JSON.stringify(body) });
}

beforeEach(() => {
  processor = { id: "proc1", complianceStatus: "REVIEW_REQUIRED" };
  updateCalls = [];
  reviewCalls = [];
});

describe("GET /api/admin/compliance/processors/[id]", () => {
  it("404s for an unknown id", async () => {
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/admin/compliance/processors/[id]", () => {
  it("404s for an unknown id", async () => {
    const res = await PATCH(patchReq({ name: "x" }), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("plain field edits go through updateProcessor, not recordProcessorReview", async () => {
    const res = await PATCH(patchReq({ name: "New Name" }), { params: Promise.resolve({ id: "proc1" }) });
    expect(res.status).toBe(200);
    expect(updateCalls[0]).toMatchObject({ name: "New Name" });
    expect(reviewCalls).toHaveLength(0);
  });

  it("requires a reviewNote when changing complianceStatus", async () => {
    const res = await PATCH(patchReq({ complianceStatus: "COMPLIANT" }), { params: Promise.resolve({ id: "proc1" }) });
    expect(res.status).toBe(400);
    expect(reviewCalls).toHaveLength(0);
  });

  it("routes a complianceStatus change through recordProcessorReview, never updateProcessor", async () => {
    const res = await PATCH(patchReq({ complianceStatus: "COMPLIANT", reviewNote: "SOC2 verified" }), { params: Promise.resolve({ id: "proc1" }) });
    expect(res.status).toBe(200);
    expect(reviewCalls[0]).toMatchObject({ id: "proc1", status: "COMPLIANT", note: "SOC2 verified" });
    expect(updateCalls).toHaveLength(0);
  });
});

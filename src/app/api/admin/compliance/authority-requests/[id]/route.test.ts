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
let reviewCalls: Array<{ id: string; status: string; note: string }>;

vi.mock("@/lib/compliance/authority-requests", () => ({
  getAuthorityRequest: vi.fn(async (id: string) => (request && request.id === id ? request : null)),
  recordLegalReview: vi.fn(async (id: string, status: string, _actor: unknown, note: string) => {
    reviewCalls.push({ id, status, note });
    return { ...request, legalReviewStatus: status };
  }),
}));

const { GET, PATCH } = await import("./route");

function patchReq(body: unknown) {
  return new Request("http://x", { method: "PATCH", body: JSON.stringify(body) });
}

beforeEach(() => {
  request = { id: "req1", verificationStatus: "UNVERIFIED", legalReviewStatus: "PENDING" };
  reviewCalls = [];
});

describe("GET /api/admin/compliance/authority-requests/[id]", () => {
  it("404s for an unknown id", async () => {
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/admin/compliance/authority-requests/[id]", () => {
  it("404s for an unknown id", async () => {
    const res = await PATCH(patchReq({ legalReviewStatus: "APPROVED", note: "x" }), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("rejects an invalid legalReviewStatus", async () => {
    const res = await PATCH(patchReq({ legalReviewStatus: "BOGUS", note: "x" }), { params: Promise.resolve({ id: "req1" }) });
    expect(res.status).toBe(400);
    expect(reviewCalls).toHaveLength(0);
  });

  it("requires a note", async () => {
    const res = await PATCH(patchReq({ legalReviewStatus: "APPROVED" }), { params: Promise.resolve({ id: "req1" }) });
    expect(res.status).toBe(400);
    expect(reviewCalls).toHaveLength(0);
  });

  it("records the legal review decision", async () => {
    const res = await PATCH(patchReq({ legalReviewStatus: "APPROVED", note: "counsel signed off" }), { params: Promise.resolve({ id: "req1" }) });
    expect(res.status).toBe(200);
    expect(reviewCalls[0]).toMatchObject({ id: "req1", status: "APPROVED", note: "counsel signed off" });
  });
});

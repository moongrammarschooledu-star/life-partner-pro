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

let listCalls: Record<string, unknown>[] = [];
let createCalls: Record<string, unknown>[] = [];

vi.mock("@/lib/compliance/authority-requests", () => ({
  listAuthorityRequests: vi.fn(async (filter: Record<string, unknown>) => {
    listCalls.push(filter);
    return [];
  }),
  createAuthorityRequest: vi.fn(async (input: Record<string, unknown>) => {
    createCalls.push(input);
    return { id: "req1", verificationStatus: "UNVERIFIED", legalReviewStatus: "PENDING", ...input };
  }),
}));

const { GET, POST } = await import("./route");

function postReq(body: unknown) {
  return new Request("http://x", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  listCalls = [];
  createCalls = [];
});

describe("GET /api/admin/compliance/authority-requests", () => {
  it("passes query filters through", async () => {
    await GET(new Request("http://x/api/admin/compliance/authority-requests?legalReviewStatus=PENDING"));
    expect(listCalls[0]).toMatchObject({ legalReviewStatus: "PENDING" });
  });
});

describe("POST /api/admin/compliance/authority-requests", () => {
  it("requires requestType, authority and scope", async () => {
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
    expect(createCalls).toHaveLength(0);
  });

  it("creates an authority request as UNVERIFIED/PENDING", async () => {
    const res = await POST(postReq({ requestType: "LAW_ENFORCEMENT", authority: "Local Police", scope: "case #123" }));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.verificationStatus).toBe("UNVERIFIED");
    expect(body.legalReviewStatus).toBe("PENDING");
  });
});
